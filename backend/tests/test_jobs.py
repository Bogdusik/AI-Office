import base64
import logging
from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.jobs import AdzunaSource, Job, JobSearch, ReedSource, SourceError, SourceNotConfigured, merge
from app.jobs.sources import STATES

ADZUNA_ID, ADZUNA_KEY, REED_KEY = "adzuna-id-123", "adzuna-secret-456", "reed-secret-789"
TODAY = date.today()


def adzuna_item(n: int, title: str, company: str, town: str, *, days_old: int = 1, description: str = "Python and FastAPI.") -> dict[str, Any]:
    return {
        "id": str(1000 + n),
        "title": title,
        "company": {"display_name": company},
        "location": {"display_name": f"{town}, West Yorkshire"},
        "salary_min": 32000,
        "salary_max": 36000,
        "salary_is_predicted": "0",
        "created": f"{TODAY - timedelta(days=days_old)}T09:00:00Z",
        "redirect_url": f"https://www.adzuna.co.uk/jobs/land/ad/{1000 + n}?se=abc",
        "description": description,
    }


def reed_item(n: int, title: str, company: str, town: str, *, days_old: int = 1, description: str = "Python &amp; SQL") -> dict[str, Any]:
    return {
        "jobId": 5000 + n,
        "jobTitle": title,
        "employerName": company,
        "locationName": town,
        "minimumSalary": 30000.0,
        "maximumSalary": None,
        "date": (TODAY - timedelta(days=days_old)).strftime("%d/%m/%Y"),
        "jobDescription": description,
        "jobUrl": f"https://www.reed.co.uk/jobs/python-developer/{5000 + n}",
    }


class Api:
    """A scripted job API: records requests; `reply` is a JSON payload, a status code or an exception."""

    def __init__(self, reply: Any) -> None:
        self.reply = reply
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        reply = self.reply(request) if callable(self.reply) else self.reply
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, int):
            return httpx.Response(reply, json={"error": "nope"})
        return httpx.Response(200, json=reply)


def adzuna(api: Api, *, keys: bool = True) -> AdzunaSource:
    secret = (SecretStr(ADZUNA_ID), SecretStr(ADZUNA_KEY)) if keys else (None, SecretStr(""))
    return AdzunaSource(*secret, timeout=2, transport=api.transport())


def reed(api: Api, *, key: bool = True) -> ReedSource:
    return ReedSource(SecretStr(REED_KEY) if key else None, timeout=2, transport=api.transport())


async def test_adzuna_search_maps_fields_and_sends_parameters() -> None:
    api = Api({"results": [adzuna_item(1, "Junior <b>Python</b> Developer", "Kestrel Payments Ltd", "Leeds")]})

    jobs = await adzuna(api).search("python developer", "Leeds", 7, 20)

    params = api.requests[0].url.params
    assert api.requests[0].url.path == "/v1/api/jobs/gb/search/1"
    assert (params["what"], params["where"], params["max_days_old"], params["results_per_page"]) == ("python developer", "Leeds", "7", "20")
    assert (params["app_id"], params["app_key"]) == (ADZUNA_ID, ADZUNA_KEY)
    [job] = jobs
    assert (job.source, job.title, job.company, job.location) == ("adzuna", "Junior Python Developer", "Kestrel Payments Ltd", "Leeds, West Yorkshire")
    assert (job.salary, job.posted, job.full) == ("£32,000–£36,000", TODAY - timedelta(days=1), False)
    assert job.links == {"adzuna": job.url} and job.ids == {"adzuna": "1001"}


async def test_reed_search_uses_basic_auth_and_filters_by_date() -> None:
    api = Api({"results": [reed_item(1, "Python Developer", "Northwind", "Leeds"), reed_item(2, "Old Python Job", "Northwind", "Leeds", days_old=30)]})

    jobs = await reed(api).search("python", "Leeds", 14, 10)

    request = api.requests[0]
    assert request.headers["authorization"] == "Basic " + base64.b64encode(f"{REED_KEY}:".encode()).decode()
    assert (request.url.params["keywords"], request.url.params["locationName"]) == ("python", "Leeds")
    assert [j.title for j in jobs] == ["Python Developer"]
    assert (jobs[0].description, jobs[0].salary) == ("Python & SQL", "£30,000")


async def test_reed_details_give_the_full_advert() -> None:
    api = Api({"jobId": 5001, "jobDescription": "<p>Full advert.</p><p>Second paragraph.</p>", "salaryType": "per annum"})
    job = Job("reed", "5001", "Python Developer", "Northwind", "Leeds", "https://www.reed.co.uk/jobs/x/5001", "Short", salary_min=30000)

    text = await reed(api).details(job)

    assert api.requests[0].url.path == "/api/1.0/jobs/5001"
    assert text == "Full advert.\nSecond paragraph."
    assert job.salary == "£30,000 (per annum)"


def test_duplicates_across_sources_are_merged() -> None:
    a = [
        Job("adzuna", "1", "Python Developer (Hybrid)", "Kestrel Payments Ltd", "Leeds, West Yorkshire", "https://a/1", "Short.", posted=TODAY - timedelta(days=3)),
        Job("adzuna", "2", "Data Engineer", "Fernhill", "Leeds", "https://a/2", "Data."),
    ]
    r = [
        Job("reed", "9", "Python Developer", "Kestrel Payments Limited", "Leeds", "https://r/9", "A much longer description of the role.", salary_min=35000, posted=TODAY - timedelta(days=1)),
        Job("reed", "8", "Python Developer", "Kestrel Payments", "Manchester", "https://r/8", "Other town."),
    ]

    merged = merge([a, r])

    assert len(merged) == 3
    kestrel = next(j for j in merged if j.location.startswith("Leeds") and j.company.startswith("Kestrel"))
    assert kestrel.links == {"adzuna": "https://a/1", "reed": "https://r/9"}
    assert kestrel.ids == {"adzuna": "1", "reed": "9"}
    assert kestrel.description == "A much longer description of the role."
    assert (kestrel.salary_min, kestrel.posted) == (35000, TODAY - timedelta(days=1))


async def test_search_merges_sources_and_reports_counts() -> None:
    ad = Api({"results": [adzuna_item(1, "Python Developer", "Kestrel Ltd", "Leeds"), adzuna_item(2, "Backend Engineer", "Brightline", "Leeds")]})
    rd = Api({"results": [reed_item(1, "Python Developer", "Kestrel", "Leeds")]})

    outcome = await JobSearch([adzuna(ad), reed(rd)]).search("python", "Leeds", 14, 20)

    assert outcome.found == {"Adzuna": 2, "Reed": 1}
    assert len(outcome.jobs) == 2 and outcome.failures == {}
    assert set(next(j for j in outcome.jobs if j.title == "Python Developer").links) == {"adzuna", "reed"}


async def test_missing_keys_skip_the_source_with_a_clear_message() -> None:
    ad = Api({"results": []})
    rd = Api({"results": [reed_item(1, "Python Developer", "Northwind", "Leeds")]})

    outcome = await JobSearch([adzuna(ad, keys=False), reed(rd)]).search("python", "", 14, 20)

    assert ad.requests == []
    assert outcome.failures == {"Adzuna": "Adzuna is not configured (ADZUNA_APP_ID and ADZUNA_APP_KEY in backend/.env)"}
    assert [j.title for j in outcome.jobs] == ["Python Developer"]
    with pytest.raises(SourceNotConfigured):
        await reed(rd, key=False).search("python", "", 14, 20)


@pytest.mark.parametrize(
    ("reply", "message"),
    [
        (500, "Adzuna answered with an error (HTTP 500)"),
        (401, "Adzuna rejected the API key (HTTP 401)"),
        (429, "Adzuna: request limit reached (HTTP 429)"),
        (httpx.ConnectError("refused"), "Adzuna is unreachable"),
        (httpx.ReadTimeout("slow"), "Adzuna did not answer within 2 s"),
    ],
)
async def test_a_failing_source_is_reported_and_the_other_still_answers(reply: Any, message: str, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    rd = Api({"results": [reed_item(1, "Python Developer", "Northwind", "Leeds")]})

    outcome = await JobSearch([adzuna(Api(reply)), reed(rd)]).search("python", "Leeds", 14, 20)

    assert outcome.failures == {"Adzuna": message}
    assert len(outcome.jobs) == 1
    assert STATES["adzuna"].error == message
    for secret in (ADZUNA_ID, ADZUNA_KEY, REED_KEY):
        assert secret not in message and secret not in caplog.text


async def test_source_error_never_carries_the_request_url() -> None:
    def boom(request: httpx.Request) -> Exception:
        return httpx.ConnectError(f"cannot connect to {request.url}", request=request)

    with pytest.raises(SourceError) as err:
        await adzuna(Api(boom)).search("python", "", 14, 20)
    assert ADZUNA_KEY not in str(err.value) and err.value.__cause__ is None and err.value.__suppress_context__


async def test_identical_searches_are_cached_for_a_while() -> None:
    now = [0.0]
    api = Api({"results": [adzuna_item(1, "Python Developer", "Kestrel", "Leeds")]})
    search = JobSearch([adzuna(api)], cache_seconds=600, clock=lambda: now[0])

    first = await search.search("Python  Developer", "leeds", 14, 20)
    first.jobs[0].description = "changed by a caller"
    again = await search.search("python developer", "Leeds", 14, 20)
    other = await search.search("python developer", "Leeds", 7, 20)
    now[0] = 601
    expired = await search.search("python developer", "Leeds", 14, 20)

    assert len(api.requests) == 3
    assert again.jobs[0].description == "Python and FastAPI." and other.jobs and expired.jobs


async def test_details_try_the_source_that_lists_the_job() -> None:
    rd = Api({"jobId": 5009, "jobDescription": "Full Reed advert."})
    job = Job("adzuna", "1", "Python Developer", "Kestrel", "Leeds", "https://a/1", "Short.", links={"adzuna": "https://a/1", "reed": "https://r/9"}, ids={"adzuna": "1", "reed": "9"})

    text, error = await JobSearch([adzuna(Api({})), reed(rd)]).details(job)

    assert (text, error) == ("Full Reed advert.", None)
    assert rd.requests[0].url.path == "/api/1.0/jobs/9"
