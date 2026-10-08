from dataclasses import replace
from typing import Any

from pydantic import SecretStr

from app.executor.job_tools import NOT_ELIGIBLE_HEADING, JobTools, finalize, strip_excluded
from app.executor.llm import LlmWorker
from app.executor.prompt import build_messages
from app.executor.research import WebTools
from app.jobs import AdzunaSource, JobSearch, ReedSource
from app.jobs.eligibility import CLEARANCE, NATIONALITY
from app.models.enums import TaskStage
from app.web import FetchLimits, PageFetcher, SearxClient
from tests.llm_fixtures import FakeOllama, RecordingReport, chunks, llm_settings, stage_input, tool_turn
from tests.test_jobs import ADZUNA_ID, ADZUNA_KEY, REED_KEY, Api, adzuna_item, reed_item
from tests.test_research import searx, sites

SC_ADVERT = "Python developer for a defence client. You must hold active SC clearance."


def job_tools(adzuna_reply: Any = None, reed_reply: Any = None, *, keys: bool = True, **limits: Any) -> tuple[JobTools, Api, Api]:
    ad = Api(adzuna_reply if adzuna_reply is not None else {"results": []})
    rd = Api(reed_reply if reed_reply is not None else {"results": []})
    sources = [
        AdzunaSource(SecretStr(ADZUNA_ID) if keys else None, SecretStr(ADZUNA_KEY) if keys else None, 2, transport=ad.transport()),
        ReedSource(SecretStr(REED_KEY) if keys else None, 2, transport=rd.transport()),
    ]
    return JobTools(search=JobSearch(sources), tool_timeout=5, **limits), ad, rd


def jobs_input(stage: TaskStage = TaskStage.RESEARCH, *, web: bool = False, description: str = "Find junior Python roles in Leeds.", **extra: Any):  # noqa: ANN201
    data = stage_input(stage, description=description)
    return replace(data, agent=replace(data.agent, web_access=web, tools=("jobs",)), **extra)


def worker(ollama: FakeOllama, jobs: JobTools | None, web: WebTools | None = None) -> LlmWorker:
    return LlmWorker(llm_settings(), ollama.transport(), web=web, jobs=jobs)


def tool_messages(request: dict[str, Any]) -> list[str]:
    return [m["content"] for m in request["messages"] if m["role"] == "tool"]


SEARCH_RESULTS = {
    "results": [
        adzuna_item(1, "Junior Python Developer", "Kestrel Payments", "Leeds"),
        adzuna_item(2, "Python Engineer", "Aegis Defence", "Leeds", description="Must be SC cleared. Python and Go."),
        adzuna_item(3, "Backend Developer", "Brightline Health", "Leeds", description="FastAPI, PostgreSQL. BPSS checks apply."),
    ]
}


async def test_search_hides_excluded_jobs_and_notes_list_them_with_the_count() -> None:
    tools, ad, rd = job_tools(SEARCH_RESULTS, {"results": [reed_item(1, "Junior Python Developer", "Kestrel Payments Ltd", "Leeds")]})
    ollama = FakeOllama(
        [
            tool_turn("search_jobs", {"query": "python developer", "location": "Leeds", "days": 7}),
            chunks("- [J1] fits: FastAPI matches the bookshop API\n- [J2] good backend match"),
        ]
    )
    report = RecordingReport()

    out = await worker(ollama, tools).run(jobs_input(), report)

    first, second = ollama.requests
    assert [t["function"]["name"] for t in first["tools"]] == ["search_jobs", "get_job"]
    assert "Stage: research with job tools" in first["messages"][1]["content"]
    [result] = tool_messages(second)
    assert result.startswith('<job_results query="python developer" location="Leeds" days="7">')
    assert "Sources: Adzuna 3, Reed 1 → 3 after merging duplicates. Excluded by the eligibility filter: 1" in result
    assert "Aegis" not in result and "SC cleared" not in result
    assert "J1. Junior Python Developer" in result and "J2. Backend Developer" in result
    for secret in (ADZUNA_ID, ADZUNA_KEY, REED_KEY):
        assert all(secret not in str(m) for m in second["messages"])

    assert out.jobs is not None
    assert [j["ref"] for j in out.jobs["jobs"]] == ["J1", "J2"]
    assert set(out.jobs["jobs"][0]["links"]) == {"adzuna", "reed"}
    [excluded] = out.jobs["excluded"]
    assert (excluded["company"], excluded["exclusions"]) == ("Aegis Defence", [{"reason": CLEARANCE, "phrase": "SC cleared"}])
    assert out.jobs["summary"] == f"Excluded by the eligibility filter: 1 (1 {CLEARANCE})"
    assert "## Jobs found (job tools)" in out.text and NOT_ELIGIBLE_HEADING in out.text
    assert f'Reason: {CLEARANCE} ("SC cleared")' in out.text
    assert out.text.index("[J1] fits") < out.text.index("## Jobs found")
    steps = report.steps[-1]
    assert [(s["kind"], s["target"], s["status"]) for s in steps] == [("jobs", "python developer · Leeds", "done")]
    assert (steps[0]["found"], steps[0]["excluded"]) == (3, 1)
    assert len(ad.requests) == len(rd.requests) == 1


async def test_get_job_reads_the_full_advert_and_applies_the_filter_to_it() -> None:
    tools, _, rd = job_tools({"results": []}, lambda r: (
        {"jobId": 5001, "jobDescription": "Great team. Applicants must be British citizens only."}
        if r.url.path.endswith("/jobs/5001")
        else {"results": [reed_item(1, "Python Developer", "Northwind", "Leeds"), reed_item(2, "Data Engineer", "Fernhill", "Leeds")]}
    ))
    ollama = FakeOllama(
        [
            tool_turn("search_jobs", {"query": "python"}),
            tool_turn("get_job", {"job": "J1"}),
            tool_turn("get_job", {"job": "J1"}),
            chunks("- [J1] Northwind looks great\n- [J2] Fernhill is a fit"),
        ]
    )
    report = RecordingReport()

    out = await worker(ollama, tools).run(jobs_input(), report)

    second_get, again = tool_messages(ollama.requests[3])[1:]
    assert second_get.startswith(f'ELIGIBILITY FILTER: J1 is not eligible: {NATIONALITY} ("British citizens only")')
    assert again == "ELIGIBILITY FILTER: J1 is not eligible. Do not recommend it."
    assert out.jobs is not None
    assert [j["ref"] for j in out.jobs["jobs"]] == ["J2"]
    assert [(j["ref"], j["full"]) for j in out.jobs["excluded"]] == [("J1", True)]
    assert [s["kind"] for s in report.steps[-1]] == ["jobs", "job"]
    assert sum(1 for r in rd.requests if r.url.path.endswith("/jobs/5001")) == 1


async def test_get_job_returns_the_advert_when_it_passes() -> None:
    tools, _, _ = job_tools({"results": []}, lambda r: (
        {"jobId": 5001, "jobDescription": "<p>We use FastAPI.</p><p>BPSS checks apply.</p>"}
        if r.url.path.endswith("/jobs/5001")
        else {"results": [reed_item(1, "Python Developer", "Northwind", "Leeds")]}
    ))
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), tool_turn("get_job", {"job": "j1"}), chunks("- [J1] fine")])

    out = await worker(ollama, tools).run(jobs_input(), RecordingReport())

    advert = tool_messages(ollama.requests[2])[1]
    assert advert.startswith('<job_advert job="J1" url="https://www.reed.co.uk/jobs/python-developer/5001">')
    assert "We use FastAPI.\nBPSS checks apply." in advert and advert.endswith("</job_advert>")
    assert out.jobs is not None and out.jobs["jobs"][0]["full"] is True


async def test_no_keys_does_not_fail_the_stage_and_the_result_says_so() -> None:
    tools, ad, rd = job_tools(keys=False)
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), chunks("- No job data available")])

    out = await worker(ollama, tools).run(jobs_input(), RecordingReport())

    [result] = tool_messages(ollama.requests[1])
    assert result.startswith("ERROR: no job source answered (Adzuna: Adzuna is not configured")
    assert ad.requests == rd.requests == []
    assert out.jobs is not None and set(out.jobs["failures"]) == {"Adzuna", "Reed"}
    assert "> Note: Adzuna was not searched: Adzuna is not configured" in out.text

    final = await worker(FakeOllama([chunks("# Shortlist\nNothing to recommend.")]), tools).run(
        jobs_input(TaskStage.SELF_CHECK, jobs=out.jobs), RecordingReport()
    )
    assert final.text.endswith("Reed was not searched: Reed is not configured (REED_API_KEY in backend/.env).")


async def test_one_source_down_is_noted_and_the_other_is_used() -> None:
    tools, _, _ = job_tools(500, {"results": [reed_item(1, "Python Developer", "Northwind", "Leeds")]})
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), chunks("- [J1] ok")])

    out = await worker(ollama, tools).run(jobs_input(), RecordingReport())

    result = tool_messages(ollama.requests[1])[0]
    assert "Adzuna: not searched — Adzuna answered with an error (HTTP 500)" in result and "J1. Python Developer" in result
    assert out.jobs is not None and out.jobs["failures"] == {"Adzuna": "Adzuna answered with an error (HTTP 500)"}


async def test_the_job_tool_limit_counts_calls_of_earlier_versions() -> None:
    tools, ad, _ = job_tools(SEARCH_RESULTS, max_calls=3)
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), chunks("- notes")])

    out = await worker(ollama, tools).run(jobs_input(job_calls_used=2), RecordingReport())

    assert "You have 1 job tool calls" in ollama.requests[0]["messages"][1]["content"]
    assert "tools" not in ollama.requests[1]
    assert len(ad.requests) == 1
    assert out.jobs is not None and out.jobs["calls"] == 1


async def test_a_used_up_job_limit_is_told_to_the_model_while_web_tools_remain() -> None:
    tools, ad, _ = job_tools(SEARCH_RESULTS, max_calls=3)
    web = WebTools(search=SearxClient("http://searx.test", transport=searx([])), fetcher=PageFetcher(FetchLimits()))
    ollama = FakeOllama([tool_turn("search_jobs", {"query": "python"}), chunks("- notes")])

    out = await worker(ollama, tools, web).run(jobs_input(web=True, job_calls_used=3), RecordingReport())

    assert tool_messages(ollama.requests[1]) == ["ERROR: the job tool limit for this task is used up (3 calls). Write the notes from what you have."]
    assert ad.requests == [] and out.jobs is not None and out.jobs["calls"] == 0


async def test_a_pasted_vacancy_that_fails_the_filter_gets_only_a_verdict() -> None:
    tools, _, _ = job_tools()
    data = jobs_input(description=f"Please review this vacancy:\n\n{SC_ADVERT}")
    research = await worker(FakeOllama([chunks("- The advert needs SC clearance")]), tools).run(data, RecordingReport())

    assert research.jobs is not None
    assert research.jobs["task_flags"] == [{"reason": CLEARANCE, "phrase": "SC clearance", "where": "task"}]
    assert research.text.startswith("> **Not eligible — no application prepared.**")

    draft_input = jobs_input(TaskStage.DRAFT, description=data.task.description, jobs=research.jobs)
    instruction = build_messages(draft_input, num_ctx=16384, reserve_tokens=6144)[1]["content"]
    assert "Stage: draft. The director's hard eligibility filter (in code) found" in instruction
    assert "Do not prepare an application" in instruction

    final = await worker(FakeOllama([chunks("## Verdict\nSkip: the role needs SC clearance.")]), tools).run(
        replace(draft_input, stage=TaskStage.SELF_CHECK), RecordingReport()
    )
    assert final.text.startswith(f'> **Not eligible — no application prepared.** The vacancy requires: {CLEARANCE} ("SC clearance")')
    assert final.text.count("Not eligible — no application prepared") == 1


async def test_a_vacancy_link_in_the_task_is_checked_when_the_page_is_read() -> None:
    page = f"<html><head><title>Python Engineer</title></head><body><article><p>{SC_ADVERT}</p><p>Hybrid in Leeds, great benefits for the whole team.</p></article></body></html>"

    async def resolve(host: str, port: int) -> list[str]:
        return ["93.184.215.14"]

    web = WebTools(
        search=SearxClient("http://searx.test", transport=searx([])),
        fetcher=PageFetcher(FetchLimits(page_chars=2000), resolve, sites({"jobs.example/123": page})),
    )
    tools, _, _ = job_tools()
    ollama = FakeOllama([tool_turn("fetch_page", {"url": "https://jobs.example/123"}), chunks("- Needs SC clearance [1]")])
    data = jobs_input(web=True, description="Review https://jobs.example/123 please")

    out = await worker(ollama, tools, web).run(data, RecordingReport())

    assert [t["function"]["name"] for t in ollama.requests[0]["tools"]] == ["web_search", "fetch_page", "search_jobs", "get_job"]
    assert "ELIGIBILITY FILTER: this page asks for" in tool_messages(ollama.requests[1])[0]
    assert out.jobs is not None and out.jobs["task_flags"][0]["where"] == "https://jobs.example/123"
    assert out.text.startswith("> **Not eligible")


async def test_a_search_request_that_mentions_clearance_is_not_a_flagged_vacancy() -> None:
    tools, _, _ = job_tools()
    data = jobs_input(description="Find Python roles in Leeds. Skip anything that needs SC clearance.")

    out = await worker(FakeOllama([chunks("- notes")]), tools).run(data, RecordingReport())

    assert out.jobs is not None and out.jobs["task_flags"] == []


async def test_agents_without_the_jobs_tool_never_get_it() -> None:
    tools, _, _ = job_tools()
    plain = stage_input(TaskStage.RESEARCH)
    ollama = FakeOllama([chunks("- notes")])

    out = await LlmWorker(llm_settings(), ollama.transport(), web=None, jobs=tools).run(replace(plain, agent=replace(plain.agent, web_access=False)), RecordingReport())

    assert "tools" not in ollama.requests[0] and out.jobs is None


REPORT: dict[str, Any] = {
    "jobs": [{"ref": "J1", "title": "Python Developer", "company": "Northwind", "url": "https://r/1", "links": {"reed": "https://r/1"}}],
    "excluded": [
        {"ref": "X1", "title": "Python Engineer", "company": "Aegis", "location": "Leeds", "salary": "£40,000", "posted": "2026-10-01",
         "url": "https://a/2", "links": {"adzuna": "https://a/2", "reed": "https://r/2"},
         "exclusions": [{"reason": CLEARANCE, "phrase": "SC cleared"}]},
        {"ref": "J3", "title": "Data Engineer", "company": "Fernhill", "url": "https://r/3", "links": {"reed": "https://r/3"},
         "exclusions": [{"reason": NATIONALITY, "phrase": "British citizens only"}]},
    ],
    "summary": f"Excluded by the eligibility filter: 2 (1 {CLEARANCE}, 1 {NATIONALITY})",
    "failures": {},
    "task_flags": [],
}


def test_finalize_removes_excluded_jobs_wherever_the_model_mentioned_them() -> None:
    text = "\n".join(
        [
            "# Shortlist",
            "1. **Python Developer — Northwind** — https://r/1",
            "   - Why it fits: FastAPI",
            "2. **Python Engineer — Aegis** — https://r/2",
            "   - Why it fits: defence work",
            "   - Missing: nothing",
            "3. Data Engineer at Fernhill (J3)",
            "",
            "| Role | Link |",
            "|---|---|",
            "| Python Developer | https://r/1 |",
            "| Python Engineer | https://a/2 |",
            "",
            "### Aegis Defence",
            "A strong option.",
            "Apply here: https://a/2",
            "",
            "## Next steps",
            "Apply to Northwind first.",
        ]
    )

    out = finalize(text, REPORT)

    body = out.split(NOT_ELIGIBLE_HEADING)[0]
    assert "Aegis" not in body and "Fernhill" not in body and "defence work" not in body and "A strong option" not in body
    assert "Python Developer — Northwind" in body and "Why it fits: FastAPI" in body and "| Python Developer | https://r/1 |" in body
    assert "## Next steps\nApply to Northwind first." in body
    tail = out.split(NOT_ELIGIBLE_HEADING)[1]
    assert f'Reason: {CLEARANCE} ("SC cleared")' in tail and f'Reason: {NATIONALITY} ("British citizens only")' in tail
    assert out.endswith(REPORT["summary"])


def test_finalize_does_not_duplicate_blocks_copied_from_the_notes() -> None:
    copied = f"# Shortlist\n- Northwind — https://r/1\n\n{NOT_ELIGIBLE_HEADING}\n- Python Engineer — Aegis — https://a/2\n\n{REPORT['summary']}"

    out = finalize(copied, REPORT)

    assert out.count(NOT_ELIGIBLE_HEADING) == 1 and out.count(REPORT["summary"]) == 1


def test_finalize_without_a_report_changes_nothing() -> None:
    assert finalize("# Result\nhttps://a/2", None) == "# Result\nhttps://a/2"
    assert strip_excluded("keep https://r/1", REPORT) == "keep https://r/1"


async def test_a_shown_job_is_withdrawn_when_another_listing_of_it_fails_the_filter() -> None:
    clean = adzuna_item(1, "Analytics Platform Engineer - Cheltenham", "Oscar Associates", "Cheltenham", description="Python and Kubernetes.")
    twin = reed_item(1, "Analytics Platform Engineer", "Oscar Associates Limited", "Cheltenham", description="Python. DV Clearance is essential.")
    calls = iter([{"results": [clean]}, {"results": []}])
    tools, _, _ = job_tools(lambda r: next(calls), lambda r: {"results": [twin]} if r.url.params.get("keywords") == "platform" else {"results": []})
    ollama = FakeOllama(
        [
            tool_turn("search_jobs", {"query": "python", "location": "Cheltenham"}),
            tool_turn("search_jobs", {"query": "platform", "location": "Cheltenham"}),
            chunks("- [J1] Oscar Associates looks good"),
        ]
    )

    out = await worker(ollama, tools).run(jobs_input(), RecordingReport())

    second = tool_messages(ollama.requests[2])[1]
    assert "Withdrawn: J1 is another listing of an excluded vacancy" in second
    assert out.jobs is not None and out.jobs["jobs"] == []
    [excluded] = out.jobs["excluded"]
    assert excluded["ref"] == "J1" and excluded["exclusions"][0]["phrase"] == "DV Clearance"
    final = finalize("# Shortlist\n- [J1] Oscar Associates — great fit\n- Nothing else", out.jobs)
    assert final.startswith("# Shortlist\n- Nothing else")


async def test_a_guide_page_about_clearance_is_not_an_excluded_vacancy() -> None:
    guide = "<html><head><title>Vetting levels</title></head><body><article><p>Security Check (SC) clearance needs 5 years of UK residency. This guide explains each level for employers and candidates in detail.</p></article></body></html>"

    async def resolve(host: str, port: int) -> list[str]:
        return ["93.184.215.14"]

    web = WebTools(
        search=SearxClient("http://searx.test", transport=searx([])),
        fetcher=PageFetcher(FetchLimits(page_chars=2000), resolve, sites({"gov.example/vetting": guide})),
    )
    tools, _, _ = job_tools()
    ollama = FakeOllama([tool_turn("fetch_page", {"url": "https://gov.example/vetting"}), chunks("- BPSS is not SC [1]")])

    out = await worker(ollama, tools, web).run(jobs_input(web=True, description="Please review this vacancy: Graduate developer, Leeds. BPSS checks apply."), RecordingReport())

    assert "ELIGIBILITY FILTER" in tool_messages(ollama.requests[1])[0]
    assert out.jobs is not None and out.jobs["excluded"] == [] and out.jobs["task_flags"] == []
    final = finalize("Verdict: apply [1]\n\n## Sources\n[1] Vetting levels — https://gov.example/vetting", out.jobs)
    assert "https://gov.example/vetting" in final and NOT_ELIGIBLE_HEADING not in final
