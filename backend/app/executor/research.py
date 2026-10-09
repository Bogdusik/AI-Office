"""Research stage with tools: web (SearXNG search, page reads) and/or job tools (`job_tools.py`), then notes.

Loop: model call with `tools` → run the requested tools → feed results back (as data, inside tags) → repeat,
until the model answers with notes or a limit is hit (then one last call without tools). Every opened page
gets a number; the notes cite those numbers, and the numbered list is appended here, not by the model.
A broken search service or page never fails the stage: the model is told, and the notes say so.
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any

from app.executor.job_tools import JOB_TOOLS, JobSession, JobTools, get_job, notes_appendix, search_jobs
from app.executor.prompt import (
    WebLimits,
    budget_chars,
    build_messages,
    search_results_block,
    shrink_tool_messages,
    web_page_block,
)
from app.executor.worker import ActivityStep, StageError, StageInput, StageOutput, StageReport
from app.web import FetchError, PageFetcher, SearchUnavailable, SearxClient

if TYPE_CHECKING:
    from app.executor.llm import LlmWorker

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web. Returns result titles, URLs and short snippets.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What to search for"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": "Open a web page (http/https) and return its main text, shortened.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "Page address, usually from search results"}},
                "required": ["url"],
            },
        },
    },
]

SEARCH_DOWN_NOTE = (
    "> Note: web search was unavailable during research (the search service did not respond), "
    "so nothing here was checked online."
)
NO_PAGES_NOTE = "> Note: no web page could be opened during research; facts above are not backed by sources."
LIMIT_REACHED = "Tool limit reached. Do not call tools any more; write the research notes now from what you have."


@dataclass(frozen=True)
class WebTools:
    search: SearxClient
    fetcher: PageFetcher
    max_calls: int = 8
    max_pages: int = 4
    tool_timeout: float = 15.0
    stage_timeout: float = 900.0
    """Active time of the whole research stage (model calls and tools, not waiting for the GPU)."""


@dataclass
class _Session:
    steps: list[ActivityStep] = field(default_factory=list)
    jobs: JobSession | None = None
    sources: list[tuple[str, str]] = field(default_factory=list)
    calls: int = 0
    searches_ok: int = 0
    searches_failed: int = 0
    pages_failed: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    tokens_per_second: float | None = None


class _ClockedReport:
    """Passes everything through and remembers when the model request was really sent (GPU wait excluded)."""

    def __init__(self, report: StageReport) -> None:
        self._report = report
        self.sent_at: float | None = None

    async def waiting(self) -> None:
        await self._report.waiting()

    async def started(self) -> None:
        self.sent_at = time.monotonic()
        await self._report.started()

    def partial(self, text: str) -> None:
        self._report.partial(text)

    async def activity(self, steps: list[ActivityStep]) -> None:
        await self._report.activity(steps)


def _arguments(call: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    fn = call.get("function") or {}
    args = fn.get("arguments") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {}
    return str(fn.get("name") or ""), args if isinstance(args, dict) else {}


async def _step(report: StageReport, session: _Session, step: ActivityStep) -> ActivityStep:
    session.steps.append(step)
    await report.activity([dict(s) for s in session.steps])
    return step


async def _finish_step(report: StageReport, session: _Session, step: ActivityStep, status: str, detail: str, **extra: Any) -> None:
    step.update(status=status, detail=detail, **extra)
    await report.activity([dict(s) for s in session.steps])


async def _web_search(tools: WebTools, report: StageReport, session: _Session, query: str) -> str:
    step = await _step(report, session, {"id": len(session.steps) + 1, "kind": "search", "target": query, "status": "running"})
    try:
        async with asyncio.timeout(tools.tool_timeout):
            results = await tools.search.search(query)
    except (SearchUnavailable, TimeoutError):
        session.searches_failed += 1
        await _finish_step(report, session, step, "failed", "search unavailable", detail_code="search_down")
        return "ERROR: web search is unavailable right now. Continue without it and say so in your notes."
    session.searches_ok += 1
    await _finish_step(
        report, session, step, "done", f"{len(results)} results", detail_code="results", detail_params={"count": len(results)}
    )
    return search_results_block(query, [(r.title, r.url, r.snippet) for r in results])


async def _fetch_page(tools: WebTools, report: StageReport, session: _Session, url: str) -> str:
    if len(session.sources) >= tools.max_pages:
        return f"ERROR: page limit reached ({tools.max_pages} pages). Write the notes from what you have."
    known = next((i for i, (u, _) in enumerate(session.sources, 1) if u == url), None)
    if known is not None:
        return f"Page {url} is already open as source [{known}]."
    step = await _step(report, session, {"id": len(session.steps) + 1, "kind": "fetch", "target": url, "status": "running"})
    try:
        async with asyncio.timeout(tools.tool_timeout):
            page = await tools.fetcher.fetch(url)
    except (FetchError, TimeoutError) as err:
        session.pages_failed += 1
        reason = str(err) or "timeout"
        await _finish_step(report, session, step, "failed", reason)
        closed = session.jobs.page_failed(url, err) if session.jobs else ""
        return f"ERROR: could not open {url}: {reason}.{closed or ' Try another result.'}"
    session.sources.append((page.url, page.title))
    number = len(session.sources)
    await _finish_step(report, session, step, "done", page.title, source=number, url=page.url)
    flagged = session.jobs.page_checked((url, page.url), page.title, page.text) if session.jobs else ""
    return web_page_block(number, page.url, page.title, page.text) + flagged


class _Steps:
    """`job_tools.StepLog` over the stage's shared list of steps (web and job steps in one timeline)."""

    def __init__(self, report: StageReport, session: _Session) -> None:
        self._report, self._session = report, session

    async def start(self, step: ActivityStep) -> ActivityStep:
        return await _step(self._report, self._session, {"id": len(self._session.steps) + 1, **step})

    async def finish(self, step: ActivityStep, status: str, detail: str, **extra: Any) -> None:
        await _finish_step(self._report, self._session, step, status, detail, **extra)


def _notes(session: _Session, text: str, web: bool) -> str:
    top, bottom = notes_appendix(session.jobs.report()) if session.jobs else ("", "")
    parts = [top, text.strip(), bottom]
    used_jobs = bool(session.jobs and session.jobs.searches)
    if web and session.searches_failed and not session.searches_ok:
        parts.append(SEARCH_DOWN_NOTE)
    elif web and not session.sources and not used_jobs:
        parts.append(NO_PAGES_NOTE)
    if session.sources:
        parts.append("## Sources\n" + "\n".join(f"[{i}] {title} — {url}" for i, (url, title) in enumerate(session.sources, 1)))
    return "\n\n".join(p for p in parts if p)


async def run_research(
    worker: "LlmWorker", tools: WebTools | None, data: StageInput, report: StageReport, jobs: JobTools | None = None
) -> StageOutput:
    """`tools`: web tools (None without web access); `jobs`: job tools (None unless the agent has them)."""
    s = worker.settings
    model = worker.model_for(data.agent)
    limits = WebLimits(calls=tools.max_calls, pages=tools.max_pages) if tools else None
    reserve = worker.reserve_for(data)
    session = _Session()
    if jobs is not None:
        session.jobs = JobSession.start(data.task.title, data.task.description, max(0, jobs.max_calls - data.job_calls_used))
    messages: list[dict[str, Any]] = list(
        build_messages(
            data,
            num_ctx=s.num_ctx,
            reserve_tokens=reserve,
            today=date.today(),
            web=limits,
            job_calls=session.jobs.calls_left if session.jobs else None,
        )
    )
    available = (TOOLS if tools else []) + (JOB_TOOLS if jobs else [])
    budget = budget_chars(s.num_ctx, reserve)
    steps = _Steps(report, session)
    stage_timeout = tools.stage_timeout if tools else (jobs.stage_timeout if jobs else 900.0)
    max_turns = (tools.max_calls if tools else 0) + (jobs.max_calls if jobs else 0) + 2
    spent = 0.0
    turns = 0

    def remaining() -> float:
        return stage_timeout - spent

    def tools_left() -> bool:
        web_left = tools is not None and session.calls < tools.max_calls
        jobs_left = session.jobs is not None and session.jobs.calls_left > 0
        return web_left or jobs_left

    while True:
        turns += 1
        final = not tools_left() or remaining() <= 0 or turns > max_turns
        if final:
            messages.append({"role": "user", "content": LIMIT_REACHED})
        shrink_tool_messages(messages, budget)
        clocked = _ClockedReport(report)
        turn = await worker.generate(model, messages, clocked, None if final else available, max(remaining(), 60.0))
        spent += time.monotonic() - (clocked.sent_at or time.monotonic())
        session.input_tokens += turn.input_tokens
        session.output_tokens += turn.output_tokens
        session.tokens_per_second = turn.tokens_per_second or session.tokens_per_second
        if final or not turn.tool_calls:
            if not turn.content:
                raise StageError("The model returned empty research notes", "empty_research_notes")
            return StageOutput(
                text=_notes(session, turn.content, web=tools is not None),
                input_tokens=session.input_tokens,
                output_tokens=session.output_tokens,
                sources=tuple(url for url, _ in session.sources),
                tokens_per_second=session.tokens_per_second,
                jobs=session.jobs.report() if session.jobs else None,
            )
        messages.append({"role": "assistant", "content": turn.content, "tool_calls": turn.tool_calls})
        for call in turn.tool_calls:
            name, args = _arguments(call)
            started = time.monotonic()
            job_tool = name in ("search_jobs", "get_job")
            if job_tool and jobs is not None and session.jobs is not None:
                if session.jobs.calls_left <= 0:
                    result = f"ERROR: the job tool limit for this task is used up ({jobs.max_calls} calls). Write the notes from what you have."
                elif name == "search_jobs" and str(args.get("query") or "").strip():
                    session.jobs.calls_left -= 1
                    session.jobs.calls += 1
                    result = await search_jobs(jobs, steps, session.jobs, args)
                elif name == "get_job" and str(args.get("job") or "").strip():
                    session.jobs.calls_left -= 1
                    session.jobs.calls += 1
                    result = await get_job(jobs, steps, session.jobs, args)
                else:
                    result = f"ERROR: missing argument for {name}."
            elif tools is None or job_tool or name not in ("web_search", "fetch_page"):
                result = f"ERROR: unknown tool or missing argument ({name})."
            elif session.calls >= tools.max_calls:
                result = LIMIT_REACHED
            elif name == "web_search" and str(args.get("query") or "").strip():
                session.calls += 1
                result = await _web_search(tools, report, session, str(args["query"]).strip())
            elif name == "fetch_page" and str(args.get("url") or "").strip():
                session.calls += 1
                result = await _fetch_page(tools, report, session, str(args["url"]).strip())
            else:
                result = f"ERROR: unknown tool or missing argument ({name})."
            spent += time.monotonic() - started
            messages.append({"role": "tool", "tool_name": name, "content": result})
