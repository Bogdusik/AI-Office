"""Job sources: the official Adzuna and Reed APIs.

Keys come from backend/.env as `SecretStr` and leave this module only inside the HTTP request. Adzuna takes them
in the query string, so error messages are built here, never from the request or the exception text, and nothing
here logs a URL. `STATES` remembers the latest outcome of each source for the server room (no extra requests).
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

import httpx
from pydantic import SecretStr

from app.jobs.models import Job, SourceError, SourceNotConfigured, number, plain_text
from app.web import FetchError, PageFetcher


@dataclass
class SourceState:
    ok_at: datetime | None = None
    error: str | None = None
    error_at: datetime | None = None


STATES: dict[str, SourceState] = {}
"""Latest outcome per source name, in this process."""


def record(name: str, error: str | None) -> None:
    state = STATES.setdefault(name, SourceState())
    if error is None:
        state.ok_at = datetime.now(UTC)
    else:
        state.error, state.error_at = error, datetime.now(UTC)


class JobSource(Protocol):
    name: str
    label: str

    @property
    def configured(self) -> bool: ...

    async def search(self, query: str, location: str, days: int, limit: int) -> list[Job]: ...

    async def details(self, job: Job) -> str | None:
        """The full advert text, or None when this source cannot give more than the snippet."""


def _secret(value: SecretStr | None) -> str:
    return value.get_secret_value().strip() if value is not None else ""


async def _get_json(label: str, timeout: float, request: Any) -> Any:
    """Runs one API request; any failure becomes a `SourceError` with a message that is safe to show."""
    try:
        response = await request
    except httpx.TimeoutException:
        raise SourceError(f"{label} did not answer within {timeout:g} s") from None
    except httpx.HTTPError:
        raise SourceError(f"{label} is unreachable") from None
    code = response.status_code
    if code in (401, 403):
        raise SourceError(f"{label} rejected the API key (HTTP {code})")
    if code == 429:
        raise SourceError(f"{label}: request limit reached (HTTP 429)")
    if code == 404:
        raise SourceError(f"{label}: not found (HTTP 404)")
    if code >= 400:
        raise SourceError(f"{label} answered with an error (HTTP {code})")
    try:
        return response.json()
    except ValueError:
        raise SourceError(f"{label} sent a response that is not JSON") from None


class AdzunaSource:
    name = "adzuna"
    label = "Adzuna"
    BASE = "https://api.adzuna.com/v1/api/jobs/gb"
    DETAILS = "https://www.adzuna.co.uk/jobs/details/{id}"

    def __init__(
        self,
        app_id: SecretStr | None,
        app_key: SecretStr | None,
        timeout: float = 15.0,
        fetcher: PageFetcher | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._id, self._key = _secret(app_id), _secret(app_key)
        self.timeout = timeout
        self._fetcher = fetcher
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._id and self._key)

    async def search(self, query: str, location: str, days: int, limit: int) -> list[Job]:
        if not self.configured:
            raise SourceNotConfigured("Adzuna is not configured (ADZUNA_APP_ID and ADZUNA_APP_KEY in backend/.env)")
        params: dict[str, str | int] = {
            "app_id": self._id,
            "app_key": self._key,
            "what": query,
            "max_days_old": days,
            "results_per_page": min(limit, 50),
            "content-type": "application/json",
        }
        if location:
            params["where"] = location
        async with httpx.AsyncClient(timeout=self.timeout, trust_env=False, transport=self._transport) as client:
            payload = await _get_json(self.label, self.timeout, client.get(f"{self.BASE}/search/1", params=params))
        return [self._job(item) for item in payload.get("results", []) if item.get("redirect_url")]

    def _job(self, item: dict[str, Any]) -> Job:
        created = str(item.get("created") or "")
        predicted = str(item.get("salary_is_predicted") or "0") == "1"
        return Job(
            source=self.name,
            source_id=str(item.get("id") or ""),
            title=plain_text(item.get("title")),
            company=plain_text((item.get("company") or {}).get("display_name")),
            location=plain_text((item.get("location") or {}).get("display_name")),
            url=str(item["redirect_url"]),
            description=plain_text(item.get("description")),
            salary_min=number(item.get("salary_min")),
            salary_max=number(item.get("salary_max")),
            salary_note="estimated by Adzuna" if predicted else "",
            posted=date.fromisoformat(created[:10]) if len(created) >= 10 else None,
        )

    async def details(self, job: Job) -> str | None:
        """Adzuna's API has only a snippet: the advert page is read through the guarded page fetcher."""
        if self._fetcher is None:
            return None
        for url in (self.DETAILS.format(id=job.source_id), job.url):
            try:
                page = await self._fetcher.fetch(url)
            except FetchError:
                continue
            if len(page.text) > len(job.description):
                return page.text
        return None


class ReedSource:
    name = "reed"
    label = "Reed"
    BASE = "https://www.reed.co.uk/api/1.0"

    def __init__(self, api_key: SecretStr | None, timeout: float = 15.0, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = _secret(api_key)
        self.timeout = timeout
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, trust_env=False, transport=self._transport, auth=(self._key, ""))

    async def search(self, query: str, location: str, days: int, limit: int) -> list[Job]:
        if not self.configured:
            raise SourceNotConfigured("Reed is not configured (REED_API_KEY in backend/.env)")
        params: dict[str, str | int] = {"keywords": query, "resultsToTake": min(100, max(limit * 2, 25))}
        if location:
            params["locationName"] = location
        async with self._client() as client:
            payload = await _get_json(self.label, self.timeout, client.get(f"{self.BASE}/search", params=params))
        since = date.today() - timedelta(days=days)
        jobs = [self._job(item) for item in payload.get("results", []) if item.get("jobUrl")]
        return [j for j in jobs if j.posted is None or j.posted >= since][:limit]

    @staticmethod
    def _date(value: object) -> date | None:
        try:
            return datetime.strptime(str(value or "")[:10], "%d/%m/%Y").date()
        except ValueError:
            return None

    def _job(self, item: dict[str, Any]) -> Job:
        return Job(
            source=self.name,
            source_id=str(item.get("jobId") or ""),
            title=plain_text(item.get("jobTitle")),
            company=plain_text(item.get("employerName")),
            location=plain_text(item.get("locationName")),
            url=str(item["jobUrl"]),
            description=plain_text(item.get("jobDescription")),
            salary_min=number(item.get("minimumSalary")),
            salary_max=number(item.get("maximumSalary")),
            posted=self._date(item.get("date")),
        )

    async def details(self, job: Job) -> str | None:
        if not self.configured or not job.source_id:
            return None
        async with self._client() as client:
            payload = await _get_json(self.label, self.timeout, client.get(f"{self.BASE}/jobs/{job.source_id}"))
        text = plain_text(payload.get("jobDescription"))
        if payload.get("salaryType") and not job.salary_note and (job.salary_min or job.salary_max):
            job.salary_note = str(payload["salaryType"])
        return text or None
