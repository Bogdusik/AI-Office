from dataclasses import replace
from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.executor.job_tools import CLOSED_HEADING, UNCHECKED_HEADING, finalize
from app.executor.prompt import build_messages
from app.executor.research import WebTools
from app.jobs import EXPIRED, OPEN, UNCHECKED, AdzunaSource, Job, closed_phrase, merge
from app.models.enums import TaskStage
from app.web import FetchLimits, PageFetcher, SearxClient
from app.web.fetch import USER_AGENT
from tests.llm_fixtures import FakeOllama, RecordingReport, chunks, tool_turn
from tests.test_job_tools import job_tools, jobs_input, tool_messages, worker
from tests.test_jobs import ADZUNA_ID, ADZUNA_KEY, Api, adzuna_item, reed, reed_item
from tests.test_research import searx

TODAY = date.today()


def dated(item: dict[str, Any], days: int) -> dict[str, Any]:
    return {**item, "expirationDate": (TODAY + timedelta(days=days)).strftime("%d/%m/%Y")}


@pytest.mark.parametrize(
    ("text", "phrase"),
    [
        ("Sorry, this job has expired. See similar jobs below.", "this job has expired"),
        ("This vacancy is no longer accepting applications.", "This vacancy is no longer accepting applications"),
        ("The position has been filled.", "The position has been filled"),
        ("This advert has now closed", "This advert has now closed"),
        ("Job expired", "Job expired"),
        ("We are no longer accepting applications.", "no longer accepting applications"),
        ("Applications for this role are now closed.", "Applications for this role are now closed"),
        ("The closing date has passed.", "The closing date has passed"),
        ("This job is no longer available", "This job is no longer available"),
    ],
)
def test_closed_advert_pages_are_recognised(text: str, phrase: str) -> None:
    assert closed_phrase(text) == phrase


@pytest.mark.parametrize(
    "text",
    [
        "Applications close on 20 October 2026.",
        "Expired DBS certificates must be renewed before you start.",
        "We are no longer accepting applications from recruitment agencies.",
        "Your session has expired, please sign in again.",
        "The role is no longer remote-only: two days a week in Leeds.",
        "This job has not expired yet, apply today.",
        "The position is open until filled.",
    ],
)
def test_ordinary_advert_text_is_not_a_closed_page(text: str) -> None:
    assert closed_phrase(text) is None


async def test_reed_closing_dates_mark_jobs_open_or_closed() -> None:
    api = Api({"results": [dated(reed_item(1, "Python Developer", "Northwind", "Leeds"), 12), dated(reed_item(2, "Data Engineer", "Fernhill", "Leeds"), -1), reed_item(3, "QA Engineer", "Brightline", "Leeds")]})

    jobs = {j.title: j for j in await reed(api).search("python", "Leeds", 14, 10)}

    open_until = (TODAY + timedelta(days=12)).isoformat()
    assert (jobs["Python Developer"].freshness, jobs["Python Developer"].freshness_note) == (OPEN, f"open until {open_until} (Reed API)")
    assert jobs["Python Developer"].expires == TODAY + timedelta(days=12)
    assert (jobs["Data Engineer"].freshness, jobs["Data Engineer"].freshness_note) == (EXPIRED, f"closed on {(TODAY - timedelta(days=1)).isoformat()} (Reed API)")
    assert (jobs["QA Engineer"].freshness, jobs["QA Engineer"].freshness_note) == (UNCHECKED, "Reed gave no closing date")


@pytest.mark.parametrize(("reply", "note"), [({"jobId": 0, "jobTitle": None, "jobDescription": None}, "Reed no longer lists it"), (404, "Reed no longer lists it (not found)")])
async def test_a_job_reed_no_longer_has_is_closed(reply: Any, note: str) -> None:
    job = Job("reed", "5001", "Python Developer", "Northwind", "Leeds", "https://www.reed.co.uk/jobs/x/5001", "Short")

    assert await reed(Api(reply)).details(job) is None
    assert (job.freshness, job.freshness_note) == (EXPIRED, note)


class Site:
    """Adzuna's pages as the guarded fetcher sees them: path → (status, html)."""

    def __init__(self, pages: dict[str, tuple[int, str]]) -> None:
        self.pages = pages
        self.requests: list[httpx.Request] = []

    def source(self) -> AdzunaSource:
        async def resolve(host: str, port: int) -> list[str]:
            return ["93.184.215.14"]

        fetcher = PageFetcher(FetchLimits(), resolve, httpx.MockTransport(self.handle))
        return AdzunaSource(SecretStr(ADZUNA_ID), SecretStr(ADZUNA_KEY), 2, fetcher=fetcher)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, html = self.pages.get(request.url.path, (404, ""))
        return httpx.Response(status, headers={"content-type": "text/html"}, text=html)


def adzuna_job() -> Job:
    return Job("adzuna", "1001", "Python Developer", "Kestrel", "Leeds", "https://www.adzuna.co.uk/jobs/land/ad/1001?se=abc&v=SIG", "Snippet.", freshness_note="Adzuna's API gives no closing date")


def page(text: str) -> str:
    return f"<html><head><title>Python Developer</title></head><body><article><p>{text}</p><p>Kestrel builds payment software for small shops across the north of England.</p></article></body></html>"


async def test_adzuna_advert_pages_tell_whether_the_job_is_open() -> None:
    gone, closed, up = adzuna_job(), adzuna_job(), adzuna_job()

    await Site({"/jobs/details/1001": (410, "")}).source().details(gone)
    await Site({"/jobs/details/1001": (200, page("Sorry, this job has expired."))}).source().details(closed)
    text = await Site({"/jobs/details/1001": (200, page("We use FastAPI and PostgreSQL."))}).source().details(up)

    assert (gone.freshness, gone.freshness_note) == (EXPIRED, "the advert page is gone (HTTP 410)")
    assert (closed.freshness, closed.freshness_note) == (EXPIRED, 'the advert page says "this job has expired"')
    assert (up.freshness, up.freshness_note) == (OPEN, "the advert page is up")
    assert text is not None and "FastAPI" in text


async def test_a_site_that_refuses_automated_requests_is_not_worked_around() -> None:
    site = Site({"/jobs/details/1001": (403, ""), "/jobs/land/ad/1001": (403, "")})
    job = adzuna_job()

    assert await site.source().details(job) is None

    assert (job.freshness, job.freshness_note) == (UNCHECKED, "the site does not let automated requests in (HTTP 403); not worked around")
    assert [r.url.path for r in site.requests] == ["/jobs/details/1001", "/jobs/land/ad/1001"]
    assert {r.headers["user-agent"] for r in site.requests} == {USER_AGENT}


async def test_closed_jobs_are_not_shown_and_the_result_lists_them_apart() -> None:
    tools, _, _ = job_tools(
        {"results": [adzuna_item(1, "Junior Python Developer", "Kestrel Payments", "Leeds")]},
        {"results": [dated(reed_item(1, "Backend Developer", "Brightline Health", "Leeds"), 10), dated(reed_item(2, "Data Engineer", "Fernhill", "Leeds"), -2)]},
    )
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python", "location": "Leeds"}), chunks("- [J1] fits\n- [J2] fits")])
    report = RecordingReport()

    research = await worker(ollama, tools).run(jobs_input(), report)

    [result] = tool_messages(ollama.requests[1])
    assert "Closed according to the source: 1 (not shown, never recommend them)." in result
    assert "Fernhill" not in result
    assert f"open until {(TODAY + timedelta(days=10)).isoformat()} (Reed API)" in result
    assert "freshness not checked (Adzuna's API gives no closing date)" in result
    assert "may already be closed" in result
    assert research.jobs is not None
    assert [(j["company"], j["freshness"]) for j in research.jobs["jobs"]] == [("Kestrel Payments", UNCHECKED), ("Brightline Health", OPEN)]
    assert [(j["ref"], j["company"]) for j in research.jobs["expired"]] == [("X1", "Fernhill")]
    assert (report.steps[-1][0]["found"], report.steps[-1][0]["expired"], report.steps[-1][0]["detail"]) == (3, 1, "найдено 3, исключено 0, закрыто 1")
    assert CLOSED_HEADING in research.text

    kestrel, brightline = (j["url"] for j in research.jobs["jobs"])
    fernhill = research.jobs["expired"][0]["url"]
    draft = f"# Shortlist\n- Junior Python Developer — Kestrel Payments — {kestrel}\n- Backend Developer — Brightline — {brightline}\n- Data Engineer — Fernhill — {fernhill}"
    final = finalize(draft, research.jobs)
    body, closed = final.split(CLOSED_HEADING)
    assert "Fernhill" not in body and "Fernhill" in closed and "Closed: closed on" in closed
    note = body[body.index(UNCHECKED_HEADING):]
    assert "> - Junior Python Developer — Kestrel Payments: Adzuna's API gives no closing date" in note
    assert "Brightline" not in note
    assert finalize(final, research.jobs) == final


async def test_get_job_finds_out_that_a_job_was_removed() -> None:
    tools, _, _ = job_tools({"results": []}, lambda r: (
        {"jobId": 0, "jobTitle": None} if r.url.path.endswith("/jobs/5001") else {"results": [dated(reed_item(1, "Python Developer", "Northwind", "Leeds"), 5)]}
    ))
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), tool_turn("get_job", {"job": "J1"}), tool_turn("get_job", {"job": "J1"}), chunks("- nothing left")])
    report = RecordingReport()

    out = await worker(ollama, tools).run(jobs_input(), report)

    first, again = tool_messages(ollama.requests[3])[1:]
    assert first == "CLOSED: J1 is no longer open (Reed no longer lists it). Do not recommend it and do not mention it as an option."
    assert again == "CLOSED: J1 is no longer open (Reed no longer lists it). Do not recommend it."
    assert out.jobs is not None and out.jobs["jobs"] == [] and out.jobs["expired"][0]["ref"] == "J1"
    assert report.steps[-1][1]["detail"] == "закрыта: Reed no longer lists it"


async def test_a_listing_closed_on_one_site_closes_the_vacancy_listed_on_another() -> None:
    tools, _, _ = job_tools(
        {"results": [adzuna_item(1, "Python Developer", "Northwind", "Leeds")]},
        {"results": [dated(reed_item(1, "Python Developer", "Northwind Ltd", "Leeds"), -3)]},
    )
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), chunks("- none")])

    out = await worker(ollama, tools).run(jobs_input(), RecordingReport())

    assert out.jobs is not None and out.jobs["jobs"] == []
    assert out.jobs["expired"][0]["links"].keys() == {"adzuna", "reed"}


def test_the_note_counts_unchecked_jobs_when_the_text_links_none() -> None:
    report = {
        "searches": [{"query": "python"}],
        "jobs": [
            {"ref": "J1", "title": "A", "company": "X", "url": "https://a/1", "links": {}, "freshness": UNCHECKED, "freshness_note": "Adzuna's API gives no closing date"},
            {"ref": "J2", "title": "B", "company": "Y", "url": "https://b/2", "links": {}, "freshness": OPEN, "freshness_note": "open until 2026-12-01 (Reed API)"},
        ],
    }

    final = finalize("# Shortlist\n- A at X\n- B at Y", report)

    assert final.endswith(f"{UNCHECKED_HEADING}\n> - 1 of 2 vacancies found: Adzuna's API gives no closing date")


def test_a_vacancy_given_as_text_is_marked_unchecked() -> None:
    final = finalize("## Verdict\nApply.", {"searches": [], "jobs": [], "task_pages": [], "task_flags": []})

    assert final.endswith("> - The vacancy was given as text, so whether it is still open was not checked")


def _web(handler: Any) -> WebTools:
    async def resolve(host: str, port: int) -> list[str]:
        return ["93.184.215.14"]

    return WebTools(search=SearxClient("http://searx.test", transport=searx([])), fetcher=PageFetcher(FetchLimits(page_chars=2000), resolve, httpx.MockTransport(handler)))


async def test_a_vacancy_link_in_the_task_that_is_gone_gets_a_closed_verdict() -> None:
    web = _web(lambda r: httpx.Response(410))
    tools, _, _ = job_tools()
    data = jobs_input(web=True, description="Review https://jobs.example/123 please")
    ollama = FakeOllama([tool_turn("fetch_page", {"url": "https://jobs.example/123"}), chunks("- The page is gone")])

    research = await worker(ollama, tools, web).run(data, RecordingReport())

    assert "The page is gone (HTTP 410): the vacancy in the task is closed" in tool_messages(ollama.requests[1])[0]
    assert research.jobs is not None and research.jobs["task_pages"] == [{"url": "https://jobs.example/123", "freshness": EXPIRED, "note": "the advert page is gone (HTTP 410)"}]
    assert research.text.startswith("> **Closed — no application prepared.** The vacancy in the task is no longer open: the advert page is gone (HTTP 410)")

    draft = jobs_input(TaskStage.DRAFT, web=True, description=data.task.description, jobs=research.jobs)
    instruction = build_messages(draft, num_ctx=16384, reserve_tokens=6144)[1]["content"]
    assert "Stage: draft. The vacancy in the task is no longer open" in instruction

    final = await worker(FakeOllama([chunks("Closed: look for similar backend roles.")]), tools, web).run(replace(draft, stage=TaskStage.SELF_CHECK), RecordingReport())
    assert final.text.startswith("> **Closed — no application prepared.**") and UNCHECKED_HEADING not in final.text


async def test_a_vacancy_link_the_site_refuses_is_reported_as_unchecked() -> None:
    web = _web(lambda r: httpx.Response(403))
    tools, _, _ = job_tools()
    data = jobs_input(web=True, description="Write a cover letter for https://jobs.example/123")
    ollama = FakeOllama([tool_turn("fetch_page", {"url": "https://jobs.example/123"}), chunks("- could not open the advert")])

    research = await worker(ollama, tools, web).run(data, RecordingReport())

    assert tool_messages(ollama.requests[1])[0] == "ERROR: could not open https://jobs.example/123: HTTP 403. Try another result."
    final = finalize("Dear hiring manager…", research.jobs)
    assert final.endswith(f"{UNCHECKED_HEADING}\n> - The vacancy in the task (https://jobs.example/123): the site does not let automated requests in (HTTP 403); not worked around")


async def test_a_closed_notice_on_the_task_page_closes_the_vacancy() -> None:
    web = _web(lambda r: httpx.Response(200, headers={"content-type": "text/html"}, text=page("This vacancy is no longer accepting applications.")))
    tools, _, _ = job_tools()
    data = jobs_input(web=True, description="Review https://jobs.example/123")
    ollama = FakeOllama([tool_turn("fetch_page", {"url": "https://jobs.example/123"}), chunks("- closed")])

    research = await worker(ollama, tools, web).run(data, RecordingReport())

    assert 'CLOSED: the advert page says "This vacancy is no longer accepting applications"' in tool_messages(ollama.requests[1])[0]
    assert research.text.startswith("> **Closed — no application prepared.**")


def test_merged_search_keeps_the_strongest_freshness() -> None:
    open_job = Job("reed", "9", "Python Developer", "Kestrel", "Leeds", "https://r/9", "Text.", freshness=OPEN, freshness_note="open until 2026-12-01 (Reed API)")
    unchecked = Job("adzuna", "1", "Python Developer", "Kestrel", "Leeds", "https://a/1", "Text.")

    [job] = merge([[unchecked], [open_job]])
    assert (job.freshness, job.freshness_note) == (OPEN, "open until 2026-12-01 (Reed API)")
