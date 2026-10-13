"""Job tools for the research stage (agents with the `jobs` tool) and the hard eligibility filter around them.

The filter never depends on the model:
- vacancies that fail it at search time are not shown to the model at all;
- one that fails when its full advert is read is reported to the model as not eligible;
- a vacancy (task text, or a page whose link is in the task) that fails it puts a fixed verdict on top of the
  result, and draft and self-check are told to write only that verdict;
- `finalize` removes every line that still mentions an excluded vacancy from the final text and appends the
  excluded list with reasons and the count.
Closed vacancies (a source's closing date has passed, the source no longer lists it, the advert page is gone or
says it has expired) are handled the same way, in their own list. A vacancy whose freshness could not be checked
is kept, and the final result says so.
Everything found is saved on the run as a plain dict (`JobSession.report`): `runs.jobs`, then `artifacts.jobs`.
"""

import asyncio
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.executor.prompt import escape_tags
from app.executor.worker import ActivityStep
from app.jobs import EXPIRED, OPEN, UNCHECKED, Exclusion, Job, JobSearch, absorb, check, closed_phrase, same_vacancy, summary
from app.jobs.freshness import GONE, REFUSED, refused
from app.web.fetch import FetchError, cut

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
CLOSED_HEADING = "## Closed vacancies (not recommended)"
UNCHECKED_HEADING = "> **Freshness not checked.** Make sure these adverts are still open before applying:"
_URL = re.compile(r"https?://[^\s<>\"')\]]+")


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
    max_query_chars: int = 200
    """Longest query or location a search may send."""


def _exclusions(items: list[Exclusion]) -> list[dict[str, str]]:
    return [{"reason": e.reason, "phrase": e.phrase} for e in items]


@dataclass
class _Entry:
    ref: str
    job: Job
    exclusions: list[Exclusion] = field(default_factory=list)

    @property
    def closed(self) -> bool:
        return not self.exclusions and self.job.freshness == EXPIRED

    @property
    def hidden(self) -> bool:
        """Never recommended: fails the filter or is closed."""
        return bool(self.exclusions) or self.job.freshness == EXPIRED


@dataclass
class JobSession:
    task_text: str
    calls_left: int
    entries: dict[str, _Entry] = field(default_factory=dict)
    """Every vacancy seen, by ref: J1… shown to the model, X1… excluded or closed before the model could see them."""
    pages: list[dict[str, Any]] = field(default_factory=list)
    """Web pages that failed the filter: {url, title, exclusions}."""
    task_pages: dict[str, dict[str, str]] = field(default_factory=dict)
    """Each link in the task (the vacancy under review) → {url, freshness, note}."""
    searches: list[dict[str, Any]] = field(default_factory=list)
    failures: dict[str, str] = field(default_factory=dict)
    task_flags: list[dict[str, str]] = field(default_factory=list)
    calls: int = 0

    @classmethod
    def start(cls, title: str, description: str, calls_left: int) -> "JobSession":
        text = f"{title}\n{description}"
        session = cls(task_text=text, calls_left=calls_left)
        session.task_flags = [{**e, "where": "task"} for e in _exclusions(check(text, director=True))]
        session.task_pages = {
            url: {"url": url, "freshness": UNCHECKED, "note": "the page was not opened"}
            for url in dict.fromkeys(u.rstrip(".,;:") for u in _URL.findall(text))
        }
        return session

    def add(self, job: Job) -> tuple[_Entry, str]:
        """Records a listing: a new vacancy, or a duplicate of one seen before (folded in and re-checked).
        Returns the entry and what happened: `new`, `seen`, or `withdrawn` (shown before, excluded or closed now)."""
        entry = next((e for e in self.entries.values() if same_vacancy(e.job, job)), None)
        if entry is None:
            exclusions = check(job.checked_text)
            entry = _Entry("", job, exclusions)
            prefix = "X" if entry.hidden else "J"
            entry.ref = f"{prefix}{sum(1 for r in self.entries if r.startswith(prefix)) + 1}"
            self.entries[entry.ref] = entry
            return entry, "new"
        was_hidden = entry.hidden
        absorb(entry.job, job)
        if not entry.exclusions:
            entry.exclusions = check(entry.job.checked_text)
        return entry, "withdrawn" if entry.hidden and not was_hidden else "seen"

    def urls(self) -> set[str]:
        """Every address the job sources gave for the vacancies seen (pages the agent may open)."""
        return {u for e in self.entries.values() for u in (e.job.url, *e.job.links.values()) if u}

    @property
    def excluded(self) -> list[_Entry]:
        return [e for e in self.entries.values() if e.exclusions]

    @property
    def closed(self) -> list[_Entry]:
        return [e for e in self.entries.values() if e.closed]

    def _task_page(self, urls: tuple[str, ...]) -> dict[str, str] | None:
        return next((p for key, p in self.task_pages.items() if any(u and (u == key or u in key or key in u) for u in urls)), None)

    def page_checked(self, urls: tuple[str, str], title: str, text: str) -> str:
        """A web page read during research (asked-for and final URL). A page whose link is in the task is the
        vacancy under review: failing the filter makes it not eligible, a "this job has expired" notice makes it
        closed. Any other page (a guide, an article) only gets a note for the model; vacancies to recommend come
        from the job tools, never from web pages."""
        notes = []
        task_page = self._task_page(urls)
        if task_page is not None:
            phrase = closed_phrase(text)
            if not phrase:
                task_page.update(freshness=OPEN, note="the advert page is up")
            else:
                task_page.update(freshness=EXPIRED, note=f'the advert page says "{phrase}"')
                notes.append(f'\n\nCLOSED: the advert page says "{phrase}". The vacancy is no longer open: do not prepare an application for it.')
        found = check(text)
        if found:
            url = urls[1]
            if any(u and u in self.task_text for u in urls):
                self.pages.append({"url": url, "title": title, "exclusions": _exclusions(found)})
                self.task_flags += [{**e, "where": url} for e in _exclusions(found)]
            reasons = "; ".join(f'{e.reason} ("{e.phrase}")' for e in found)
            notes.insert(0, f"\n\nELIGIBILITY FILTER: this page asks for {reasons}. If it is a vacancy, it is not eligible: do not recommend it and do not prepare an application for it.")
        return "".join(notes)

    def page_failed(self, url: str, error: FetchError | TimeoutError) -> str:
        """A link from the task that could not be opened: gone (HTTP 404/410) means closed; anything else, or a
        site that refuses automated requests, leaves its freshness unchecked."""
        task_page = self._task_page((url,))
        if task_page is None:
            return ""
        status = error.status if isinstance(error, FetchError) else None
        if status in GONE:
            task_page.update(freshness=EXPIRED, note=f"the advert page is gone (HTTP {status})")
            return f" The page is gone (HTTP {status}): the vacancy in the task is closed, do not prepare an application for it."
        task_page.update(note=refused(status) if status in REFUSED else f"the page could not be opened ({error or 'timeout'})")
        return ""

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
            "jobs": [row(e) for e in self.entries.values() if not e.hidden],
            "excluded": excluded,
            "expired": [row(e) for e in self.closed],
            "summary": summary([[Exclusion(**x) for x in e["exclusions"]] for e in excluded]) if (self.searches or excluded) else "",
            "failures": self.failures,
            "task_flags": self.task_flags,
            "task_pages": list(self.task_pages.values()),
        }


def _clamp(value: object, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(str(value))))
    except (TypeError, ValueError):
        return default


def _attr(value: str) -> str:
    return escape_tags(value).replace('"', "&quot;")


def freshness_text(state: object, note: object) -> str:
    if state == OPEN:
        return str(note)
    if state == EXPIRED:
        return f"closed: {note}"
    return f"freshness not checked ({note})" if note else "freshness not checked"


def _line(entry: _Entry) -> str:
    j = entry.job
    posted = f"posted {j.posted.isoformat()}" if j.posted else "posting date unknown"
    text = "full advert read" if j.full else "snippet only"
    head = " — ".join(escape_tags(p) for p in (j.title, j.company or "company not stated", j.location or "location not stated"))
    fresh = escape_tags(freshness_text(j.freshness, j.freshness_note))
    return f"{entry.ref}. {head} — {j.salary} — {posted} — {fresh} — {text}\n    {escape_tags(j.url)}"


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
        session.searches.append({"query": query, "location": location, "days": days, "found": {}, "shown": 0, "excluded": 0, "expired": 0, "failures": failures})
        reasons_text = "; ".join(failures.values())
        if reasons_text:
            await steps.finish(step, "failed", reasons_text, detail_code="sources_failed", detail_params={"reasons": reasons_text})
        else:
            await steps.finish(step, "failed", "sources unavailable", detail_code="sources_down")
        reasons = "; ".join(f"{k}: {v}" for k, v in failures.items())
        return f"ERROR: no job source answered ({reasons}). Continue without job search and say so in your notes."

    session.failures.update(outcome.failures)
    shown: list[_Entry] = []
    withdrawn: list[_Entry] = []
    excluded = expired = 0
    for job in outcome.jobs:
        entry, what = session.add(job)
        if what == "withdrawn":
            withdrawn.append(entry)
        elif entry.hidden:
            excluded += int(what == "new" and bool(entry.exclusions))
            expired += int(what == "new" and entry.closed)
        elif entry not in shown:
            shown.append(entry)
    found = outcome.found
    total = len(shown) + excluded + expired
    session.searches.append(
        {"query": query, "location": location, "days": days, "found": found, "shown": len(shown), "excluded": excluded, "expired": expired, "failures": outcome.failures}
    )
    detail = f"found {total}, excluded {excluded}" + (f", closed {expired}" if expired else "")
    await steps.finish(
        step, "done", detail, found=total, excluded=excluded, expired=expired,
        detail_code="jobs_found_closed" if expired else "jobs_found",
        detail_params={"found": total, "excluded": excluded, "closed": expired},
    )

    counts = ", ".join(f"{label} {n}" for label, n in found.items())
    lines = [
        f'<job_results query="{_attr(query)}" location="{_attr(location)}" days="{days}">',
        f"Sources: {counts} → {len(outcome.jobs)} after merging duplicates. "
        f"Excluded by the eligibility filter: {excluded} (not shown, never recommend them).",
    ]
    if expired:
        lines.append(f"Closed according to the source: {expired} (not shown, never recommend them).")
    lines += [f"{label}: not searched — {why}" for label, why in outcome.failures.items()]
    lines += [
        f"Withdrawn: {e.ref} is another listing of "
        + (f"an excluded vacancy ({e.exclusions[0].reason})." if e.exclusions else f"a closed vacancy ({e.job.freshness_note}).")
        + " Do not recommend it."
        for e in withdrawn
    ]
    for entry in shown:
        snippet = " ".join(entry.job.description.split())[:300]
        lines.append(_line(entry) + (f"\n    Snippet: {escape_tags(snippet)}" if snippet else ""))
    if not shown:
        lines.append("No eligible jobs for this search.")
    lines.append("</job_results>")
    lines.append('Read the full advert with get_job (e.g. "J1") before recommending a job that has only a snippet.')
    if any(e.job.freshness == UNCHECKED for e in shown):
        lines.append("A job marked 'freshness not checked' may already be closed: say so wherever you mention it.")
    return "\n".join(lines)


async def get_job(tools: JobTools, steps: StepLog, session: JobSession, args: Mapping[str, Any]) -> str:
    ref = str(args.get("job") or "").strip().strip("[]").upper()
    entry = session.entries.get(ref)
    if entry is None or ref.startswith("X"):
        return f"ERROR: unknown job {ref or '(empty)'}. Use a number from search_jobs results, e.g. J1."
    job = entry.job
    if entry.exclusions:
        return f"ELIGIBILITY FILTER: {ref} is not eligible. Do not recommend it."
    if entry.closed:
        return f"CLOSED: {ref} is no longer open ({job.freshness_note}). Do not recommend it."
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
        await steps.finish(
            step, "done", f"not eligible: {found[0].reason}", detail_code="job_not_eligible", detail_params={"reason": found[0].reason}
        )
        return f"ELIGIBILITY FILTER: {ref} is not eligible: {reasons}. Do not recommend it and do not mention it as an option."
    if entry.closed:
        await steps.finish(
            step, "done", f"closed: {job.freshness_note}", detail_code="job_closed", detail_params={"note": job.freshness_note}
        )
        return f"CLOSED: {ref} is no longer open ({job.freshness_note}). Do not recommend it and do not mention it as an option."
    if not job.full:
        if error:
            await steps.finish(step, "failed", error, detail_code="job_unreadable", detail_params={"error": error})
        else:
            await steps.finish(step, "failed", "full text unavailable", detail_code="job_snippet_only")
        return f"Could not read the full advert of {ref} ({error or 'the source gives only a snippet'}). It is checked on the snippet only."
    await steps.finish(step, "done", "full text read", detail_code="job_read")
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


def _closed_line(row: Mapping[str, Any]) -> str:
    return f"{_job_line(row, with_ref=False)}\n  - Closed: {row.get('freshness_note')}"


def closed_task_pages(report: Mapping[str, Any]) -> list[Mapping[str, str]]:
    return [p for p in report.get("task_pages") or [] if p.get("freshness") == EXPIRED]


def verdict_block(report: Mapping[str, Any]) -> str:
    if flags := report.get("task_flags") or []:
        reasons = "; ".join(f'{f["reason"]} ("{f["phrase"]}")' for f in flags)
        return (
            "> **Not eligible — no application prepared.** The vacancy requires: "
            f"{reasons}. This is a hard filter in code: the director cannot meet this requirement."
        )
    if closed := closed_task_pages(report):
        reasons = "; ".join(f"{p['note']} ({p['url']})" for p in closed)
        return f"> **Closed — no application prepared.** The vacancy in the task is no longer open: {reasons}."
    return ""


def _mentions(text: str, row: Mapping[str, Any]) -> bool:
    return any(url and str(url) in text for url in {row.get("url"), *(row.get("links") or {}).values()})


def freshness_note(text: str, report: Mapping[str, Any]) -> str:
    """Where freshness could not be checked, the result says so: for each vacancy the text mentions (by its link),
    or for all of them when the text links none, and for a vacancy given in the task."""
    if verdict_block(report):
        return ""
    lines = [f"- The vacancy in the task ({p['url']}): {p['note']}" for p in report.get("task_pages") or [] if p.get("freshness") == UNCHECKED]
    jobs = list(report.get("jobs") or [])
    unchecked = [r for r in jobs if r.get("freshness", UNCHECKED) == UNCHECKED]
    mentioned = [r for r in unchecked if _mentions(text, r)]
    if mentioned or any(_mentions(text, r) for r in jobs):
        lines += [f"- {r.get('title')} — {r.get('company') or 'company not stated'}: {r.get('freshness_note') or 'not checked'}" for r in mentioned]
    elif unchecked:
        reasons = "; ".join(dict.fromkeys(str(r.get("freshness_note") or "not checked") for r in unchecked))
        lines.append(f"- {len(unchecked)} of {len(jobs)} vacancies found: {reasons}")
    if not lines and not report.get("searches") and not report.get("task_pages"):
        lines.append("- The vacancy was given as text, so whether it is still open was not checked")
    return "\n".join([UNCHECKED_HEADING, *(f"> {line}" for line in lines)]) if lines else ""


def failures_note(report: Mapping[str, Any]) -> str:
    failures = report.get("failures") or {}
    if not failures:
        return ""
    return "> Note: " + " ".join(f"{label} was not searched: {why}." for label, why in failures.items())


def notes_appendix(report: Mapping[str, Any]) -> tuple[str, str]:
    """(top, bottom) added to the research notes by code: the verdict, the jobs found, the excluded and closed ones."""
    bottom: list[str] = []
    if report.get("jobs"):
        bottom.append(
            "## Jobs found (job tools)\n"
            + "\n".join(
                f"{_job_line(r)} — {freshness_text(r.get('freshness'), r.get('freshness_note'))} — {'full advert read' if r.get('full') else 'snippet only'}"
                for r in report["jobs"]
            )
        )
    if report.get("excluded"):
        bottom.append(f"{NOT_ELIGIBLE_HEADING}\n" + "\n".join(_excluded_line(r) for r in report["excluded"]))
    if report.get("summary"):
        bottom.append(report["summary"])
    if report.get("expired"):
        bottom.append(f"{CLOSED_HEADING}\n" + "\n".join(_closed_line(r) for r in report["expired"]))
    if note := failures_note(report):
        bottom.append(note)
    return verdict_block(report), "\n\n".join(bottom)


_HEADING = re.compile(r"^(#{1,6})\s")
_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s")


def _banned(report: Mapping[str, Any]) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for row in [*(report.get("excluded") or []), *(report.get("expired") or [])]:
        for url in {row.get("url"), *(row.get("links") or {}).values()}:
            if url:
                patterns.append(re.compile(re.escape(str(url))))
        if str(row.get("ref") or "").startswith("J"):
            patterns.append(re.compile(rf"\b{re.escape(row['ref'])}\b"))
    return patterns


def strip_excluded(text: str, report: Mapping[str, Any]) -> str:
    """Drops every heading block, list item (with its sub-items) or line that mentions an excluded or closed vacancy."""
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


def _without_note(text: str) -> str:
    """Drops a freshness note copied from a previous version (it is rebuilt for this one)."""
    lines, kept, inside = text.splitlines(), [], False
    for line in lines:
        if line.strip() == UNCHECKED_HEADING:
            inside = True
            continue
        if inside and line.lstrip().startswith(">"):
            continue
        inside = False
        kept.append(line)
    return "\n".join(kept)


def finalize(text: str, report: Mapping[str, Any] | None) -> str:
    """The final result of a task that used the job tools: filter applied in code, excluded and closed lists, the
    count and a note on unchecked freshness appended."""
    if not report:
        return text
    body = _without_note(strip_excluded(text, report))
    for fixed in (verdict_block(report), NOT_ELIGIBLE_HEADING, CLOSED_HEADING, report.get("summary") or "", failures_note(report)):
        if fixed:
            body = "\n".join(line for line in body.splitlines() if line.strip() != fixed).strip()
    parts = [verdict_block(report), body, freshness_note(body, report)]
    if report.get("excluded"):
        parts.append(f"{NOT_ELIGIBLE_HEADING}\n" + "\n".join(_excluded_line(r) for r in report["excluded"]))
    if report.get("summary"):
        parts.append(report["summary"])
    if report.get("expired"):
        parts.append(f"{CLOSED_HEADING}\n" + "\n".join(_closed_line(r) for r in report["expired"]))
    parts.append(failures_note(report))
    return "\n\n".join(p for p in parts if p)
