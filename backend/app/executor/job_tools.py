"""Job tools for the research stage (agents with the `jobs` tool) and the hard eligibility filter around them.

The filter never depends on the model:
- vacancies that fail it at search time are not shown to the model at all;
- one that fails when its full advert is read is reported to the model as not eligible;
- a vacancy (task text, or a page whose link is in the task) that fails it puts a fixed verdict on top of the
  result, and draft and self-check are told to write only that verdict;
- `finalize` removes every line that still mentions an excluded vacancy from the final text and appends the
  excluded list with reasons and the count.
Everything found is saved on the run as a plain dict (`JobSession.report`): `runs.jobs`, then `artifacts.jobs`.
"""

import asyncio
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.executor.prompt import escape_tags
from app.executor.worker import ActivityStep
from app.jobs import Exclusion, Job, JobSearch, absorb, check, same_vacancy, summary
from app.web.fetch import cut

JOB_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_jobs",
            "description": "Search UK vacancies in the official Adzuna and Reed APIs. Returns numbered jobs (J1, J2…) "
            "with title, company, location, salary, posting date, link and a short snippet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Job title or keywords, e.g. 'junior python developer'"},
                    "location": {"type": "string", "description": "Town or region, e.g. 'Leeds'; empty for the whole UK"},
                    "days": {"type": "integer", "description": "Only jobs posted in the last N days (1-60, default 14)"},
                    "limit": {"type": "integer", "description": "How many jobs to return (default 20)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_job",
            "description": "Read the full advert of a job from search_jobs results by its number, e.g. 'J3'.",
            "parameters": {
                "type": "object",
                "properties": {"job": {"type": "string", "description": "Job number from search_jobs, e.g. 'J3'"}},
                "required": ["job"],
            },
        },
    },
]

DEFAULT_DAYS = 14
DEFAULT_LIMIT = 20
NOT_ELIGIBLE_HEADING = "## Not eligible (hard filter)"


class StepLog(Protocol):
    async def start(self, step: ActivityStep) -> ActivityStep: ...
    async def finish(self, step: ActivityStep, status: str, detail: str, **extra: Any) -> None: ...


@dataclass(frozen=True)
class JobTools:
    search: JobSearch
    max_calls: int = 10
    """Per task, across all its versions."""
    tool_timeout: float = 30.0
    max_results: int = 50
    advert_chars: int = 6000
    stage_timeout: float = 900.0
    """Active time of a research stage that has only job tools (with web tools, theirs applies)."""


def _exclusions(items: list[Exclusion]) -> list[dict[str, str]]:
    return [{"reason": e.reason, "phrase": e.phrase} for e in items]


@dataclass
class _Entry:
    ref: str
    job: Job
    exclusions: list[Exclusion] = field(default_factory=list)


@dataclass
class JobSession:
    task_text: str
    calls_left: int
    entries: dict[str, _Entry] = field(default_factory=dict)
    """Every vacancy seen, by ref: J1… shown to the model, X1… excluded before the model could see them."""
    pages: list[dict[str, Any]] = field(default_factory=list)
    """Web pages that failed the filter: {url, title, exclusions}."""
    searches: list[dict[str, Any]] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)
    task_flags: list[dict[str, str]] = field(default_factory=list)
    calls: int = 0

    @classmethod
    def start(cls, title: str, description: str, calls_left: int) -> "JobSession":
        text = f"{title}\n{description}"
        session = cls(task_text=text, calls_left=calls_left)
        session.task_flags = [{**e, "where": "task"} for e in _exclusions(check(text, director=True))]
        return session

    def add(self, job: Job) -> tuple[_Entry, str]:
        """Records a listing: a new vacancy, or a duplicate of one seen before (folded in and re-checked).
        Returns the entry and what happened: `new`, `seen`, or `withdrawn` (shown before, excluded now)."""
        entry = next((e for e in self.entries.values() if same_vacancy(e.job, job)), None)
        if entry is None:
            exclusions = check(job.checked_text)
            prefix = "X" if exclusions else "J"
            ref = f"{prefix}{sum(1 for r in self.entries if r.startswith(prefix)) + 1}"
            entry = _Entry(ref, job, exclusions)
            self.entries[ref] = entry
            return entry, "new"
        absorb(entry.job, job)
        if entry.exclusions:
            return entry, "seen"
        entry.exclusions = check(entry.job.checked_text)
        return entry, "withdrawn" if entry.exclusions else "seen"

    @property
    def excluded(self) -> list[_Entry]:
        return [e for e in self.entries.values() if e.exclusions]

    def page_checked(self, urls: tuple[str, str], title: str, text: str) -> str:
        """A web page read during research (asked-for and final URL). A page whose link is in the task is the
        vacancy under review: failing the filter makes it not eligible. Any other page (a guide, an article) only
        gets a note for the model; vacancies to recommend come from the job tools, never from web pages."""
        found = check(text)
        if not found:
            return ""
        url = urls[1]
        if any(u and u in self.task_text for u in urls):
            self.pages.append({"url": url, "title": title, "exclusions": _exclusions(found)})
            self.task_flags += [{**e, "where": url} for e in _exclusions(found)]
        reasons = "; ".join(f'{e.reason} ("{e.phrase}")' for e in found)
        return f"\n\nELIGIBILITY FILTER: this page asks for {reasons}. If it is a vacancy, it is not eligible: do not recommend it and do not prepare an application for it."

    def report(self) -> dict[str, Any]:
        def row(e: _Entry) -> dict[str, Any]:
            return {"ref": e.ref, **e.job.to_dict(), "exclusions": _exclusions(e.exclusions)}

        excluded = [row(e) for e in self.excluded] + [
            {"ref": "", "title": p["title"], "company": "", "location": "", "url": p["url"], "links": {"web": p["url"]},
             "salary": "", "posted": None, "full": True, "exclusions": p["exclusions"]}
            for p in self.pages
        ]
        return {
            "calls": self.calls,
            "searches": self.searches,
            "jobs": [row(e) for e in self.entries.values() if not e.exclusions],
            "excluded": excluded,
            "summary": summary([[Exclusion(**x) for x in e["exclusions"]] for e in excluded]) if (self.searches or excluded) else "",
            "failures": self.failures,
            "task_flags": self.task_flags,
        }


def _clamp(value: object, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(str(value))))
    except (TypeError, ValueError):
        return default


def _attr(value: str) -> str:
    return escape_tags(value).replace('"', "&quot;")


def _line(entry: _Entry) -> str:
    j = entry.job
    posted = f"posted {j.posted.isoformat()}" if j.posted else "posting date unknown"
    text = "full advert read" if j.full else "snippet only"
    head = " — ".join(escape_tags(p) for p in (j.title, j.company or "company not stated", j.location or "location not stated"))
    return f"{entry.ref}. {head} — {j.salary} — {posted} — {text}\n    {escape_tags(j.url)}"


async def search_jobs(tools: JobTools, steps: StepLog, session: JobSession, args: Mapping[str, Any]) -> str:
    query = " ".join(str(args.get("query") or "").split())
    location = " ".join(str(args.get("location") or "").split())
    days = _clamp(args.get("days"), DEFAULT_DAYS, 1, 60)
    limit = _clamp(args.get("limit"), DEFAULT_LIMIT, 1, tools.max_results)
    target = f"{query} · {location}" if location else query
    step = await steps.start({"kind": "jobs", "target": target, "status": "running"})
    try:
        async with asyncio.timeout(tools.tool_timeout):
            outcome = await tools.search.search(query, location, days, limit)
    except TimeoutError:
        outcome = None
    if outcome is None or not outcome.found:
        failures = outcome.failures if outcome else {"Job search": f"no answer within {tools.tool_timeout:g} s"}
        session.failures.update(failures)
        session.searches.append({"query": query, "location": location, "days": days, "found": {}, "shown": 0, "excluded": 0, "failures": failures})
        await steps.finish(step, "failed", "; ".join(failures.values()) or "источники недоступны")
        reasons = "; ".join(f"{k}: {v}" for k, v in failures.items())
        return f"ERROR: no job source answered ({reasons}). Continue without job search and say so in your notes."

    session.failures.update(outcome.failures)
    shown: list[_Entry] = []
    withdrawn: list[_Entry] = []
    excluded = 0
    for job in outcome.jobs:
        entry, what = session.add(job)
        if what == "withdrawn":
            withdrawn.append(entry)
        elif entry.exclusions:
            excluded += int(what == "new")
        elif entry not in shown:
            shown.append(entry)
    found = outcome.found
    session.searches.append(
        {"query": query, "location": location, "days": days, "found": found, "shown": len(shown), "excluded": excluded, "failures": outcome.failures}
    )
    await steps.finish(step, "done", f"найдено {len(shown) + excluded}, исключено {excluded}", found=len(shown) + excluded, excluded=excluded)

    counts = ", ".join(f"{label} {n}" for label, n in found.items())
    lines = [
        f'<job_results query="{_attr(query)}" location="{_attr(location)}" days="{days}">',
        f"Sources: {counts} → {len(outcome.jobs)} after merging duplicates. "
        f"Excluded by the eligibility filter: {excluded} (not shown, never recommend them).",
    ]
    lines += [f"{label}: not searched — {why}" for label, why in outcome.failures.items()]
    lines += [
        f"Withdrawn: {e.ref} is another listing of an excluded vacancy ({e.exclusions[0].reason}). Do not recommend it."
        for e in withdrawn
    ]
    for entry in shown:
        snippet = " ".join(entry.job.description.split())[:300]
        lines.append(_line(entry) + (f"\n    Snippet: {escape_tags(snippet)}" if snippet else ""))
    if not shown:
        lines.append("No eligible jobs for this search.")
    lines.append("</job_results>")
    lines.append('Read the full advert with get_job (e.g. "J1") before recommending a job that has only a snippet.')
    return "\n".join(lines)


async def get_job(tools: JobTools, steps: StepLog, session: JobSession, args: Mapping[str, Any]) -> str:
    ref = str(args.get("job") or "").strip().strip("[]").upper()
    entry = session.entries.get(ref)
    if entry is None or ref.startswith("X"):
        return f"ERROR: unknown job {ref or '(empty)'}. Use a number from search_jobs results, e.g. J1."
    job = entry.job
    if entry.exclusions:
        return f"ELIGIBILITY FILTER: {ref} is not eligible. Do not recommend it."
    step = await steps.start({"kind": "job", "target": f"{ref} {job.title} — {job.company}".strip(" —"), "status": "running", "url": job.url})
    error = None
    if not job.full:
        try:
            async with asyncio.timeout(tools.tool_timeout):
                text, error = await tools.search.details(job)
        except TimeoutError:
            text, error = None, f"no answer within {tools.tool_timeout:g} s"
        if text:
            job.description, job.full = text, True
            job.texts.append(text)
    found = check(job.checked_text)
    if found:
        entry.exclusions = found
        reasons = "; ".join(f'{e.reason} ("{e.phrase}")' for e in found)
        await steps.finish(step, "done", f"недоступна: {found[0].reason}")
        return f"ELIGIBILITY FILTER: {ref} is not eligible: {reasons}. Do not recommend it and do not mention it as an option."
    if not job.full:
        await steps.finish(step, "failed", error or "полный текст недоступен")
        return f"Could not read the full advert of {ref} ({error or 'the source gives only a snippet'}). It is checked on the snippet only."
    await steps.finish(step, "done", "полный текст прочитан")
    text, _ = cut(job.description, tools.advert_chars)
    return "\n".join(
        [f'<job_advert job="{ref}" url="{_attr(job.url)}">', _line(entry), "", escape_tags(text), "</job_advert>"]
    )


# ---------- notes and the final result ----------


def _job_line(row: Mapping[str, Any], with_ref: bool = True) -> str:
    parts = [str(row.get("title") or "")]
    parts += [str(row[k]) for k in ("company", "location") if row.get(k)]
    if row.get("salary"):
        parts.append(str(row["salary"]))
    if row.get("posted"):
        parts.append(f"posted {row['posted']}")
    ref = f"[{row['ref']}] " if with_ref and row.get("ref") else ""
    return f"- {ref}{' — '.join(p for p in parts if p)} — {row.get('url')}"


def _excluded_line(row: Mapping[str, Any]) -> str:
    reasons = "; ".join(f'{e["reason"]} ("{e["phrase"]}")' for e in row.get("exclusions", []))
    return f"{_job_line(row, with_ref=False)}\n  - Reason: {reasons}"


def verdict_block(report: Mapping[str, Any]) -> str:
    flags = report.get("task_flags") or []
    if not flags:
        return ""
    reasons = "; ".join(f'{f["reason"]} ("{f["phrase"]}")' for f in flags)
    return (
        "> **Not eligible — no application prepared.** The vacancy requires: "
        f"{reasons}. This is a hard filter in code: the director cannot meet this requirement."
    )


def failures_note(report: Mapping[str, Any]) -> str:
    failures = report.get("failures") or {}
    if not failures:
        return ""
    return "> Note: " + " ".join(f"{label} was not searched: {why}." for label, why in failures.items())


def notes_appendix(report: Mapping[str, Any]) -> tuple[str, str]:
    """(top, bottom) added to the research notes by code: the verdict, the jobs found, the excluded ones."""
    bottom: list[str] = []
    if report.get("jobs"):
        bottom.append("## Jobs found (job tools)\n" + "\n".join(_job_line(r) + (" — full advert read" if r.get("full") else " — snippet only") for r in report["jobs"]))
    if report.get("excluded"):
        bottom.append(f"{NOT_ELIGIBLE_HEADING}\n" + "\n".join(_excluded_line(r) for r in report["excluded"]))
    if report.get("summary"):
        bottom.append(report["summary"])
    if note := failures_note(report):
        bottom.append(note)
    return verdict_block(report), "\n\n".join(bottom)


_HEADING = re.compile(r"^(#{1,6})\s")
_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s")


def _banned(report: Mapping[str, Any]) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for row in report.get("excluded") or []:
        for url in {row.get("url"), *(row.get("links") or {}).values()}:
            if url:
                patterns.append(re.compile(re.escape(str(url))))
        if str(row.get("ref") or "").startswith("J"):
            patterns.append(re.compile(rf"\b{re.escape(row['ref'])}\b"))
    return patterns


def strip_excluded(text: str, report: Mapping[str, Any]) -> str:
    """Drops every heading block, list item (with its sub-items) or line that mentions an excluded vacancy."""
    banned = _banned(report)
    if not banned:
        return text
    hit = lambda line: any(p.search(line) for p in banned)  # noqa: E731
    lines = text.splitlines()
    drop = [False] * len(lines)
    for i, line in enumerate(lines):
        if heading := _HEADING.match(line):
            level = len(heading.group(1))
            end = next((k for k in range(i + 1, len(lines)) if (h := _HEADING.match(lines[k])) and len(h.group(1)) <= level), len(lines))
            if level >= 3 and any(hit(lines[k]) for k in range(i, end)):
                drop[i:end] = [True] * (end - i)
    for i, line in enumerate(lines):
        if drop[i] or not hit(line):
            continue
        drop[i] = True
        item = _ITEM.match(line)
        if not item:
            # a wrapped line of a list item: drop the whole item
            back = i - 1
            while back >= 0 and lines[back].strip() and not _ITEM.match(lines[back]) and not _HEADING.match(lines[back]):
                back -= 1
            if back >= 0 and (m := _ITEM.match(lines[back])):
                item = m
                drop[back : i + 1] = [True] * (i + 1 - back)
        if item:
            indent = len(item.group(1))
            k = i + 1
            while k < len(lines) and lines[k].strip() and len(lines[k]) - len(lines[k].lstrip()) > indent:
                drop[k] = True
                k += 1
    kept = [line for line, gone in zip(lines, drop, strict=True) if not gone]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def finalize(text: str, report: Mapping[str, Any] | None) -> str:
    """The final result of a task that used the job tools: filter applied in code, excluded list and count appended."""
    if not report:
        return text
    body = strip_excluded(text, report)
    for fixed in (verdict_block(report), NOT_ELIGIBLE_HEADING, report.get("summary") or "", failures_note(report)):
        if fixed:
            body = "\n".join(line for line in body.splitlines() if line.strip() != fixed).strip()
    parts = [verdict_block(report), body]
    if report.get("excluded"):
        parts.append(f"{NOT_ELIGIBLE_HEADING}\n" + "\n".join(_excluded_line(r) for r in report["excluded"]))
    if report.get("summary"):
        parts.append(report["summary"])
    parts.append(failures_note(report))
    return "\n\n".join(p for p in parts if p)
