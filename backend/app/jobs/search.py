"""Search every configured source at once, merge duplicates, cache identical searches for a short time.

Each API request takes a unit of the provider's daily limit (`Budget`, see `usage.py`); a failed request is
remembered for `failure_seconds`, so the same search does not hit a struggling or rate-limited API again at once.
"""

import asyncio
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import Protocol

from app.jobs.freshness import EXPIRED, RANK
from app.jobs.models import Job, SourceError, SourceNotConfigured
from app.jobs.sources import JobSource, SourceGone, record

_COMPANY_SUFFIX = re.compile(r"\b(?:ltd|limited|plc|llp|inc|group|uk|recruitment)\b")
_TITLE_NOISE = re.compile(r"\(.*?\)|\[.*?\]|\b(?:remote|hybrid|urgent|new)\b")
_NON_WORD = re.compile(r"[^a-z0-9]+")


def _norm(text: str, noise: re.Pattern[str] | None = None) -> str:
    text = text.lower().replace("&", " and ")
    if noise is not None:
        text = noise.sub(" ", text)
    return " ".join(_NON_WORD.sub(" ", text).split())


_GENERIC_PLACE = frozenset({"uk", "united", "kingdom", "england", "scotland", "wales", "gb", "remote", "hybrid", "area"})


def _place(job: Job) -> set[str]:
    return set(_norm(job.location).split()) - _GENERIC_PLACE


def same_vacancy(a: Job, b: Job) -> bool:
    """Same company and same title (town names in the title ignored) in an overlapping place → one vacancy,
    whichever site lists it ("Engineer - Cheltenham" in "Cheltenham Trade Park" = "Engineer" in "Cheltenham")."""
    if _norm(a.company, _COMPANY_SUFFIX) != _norm(b.company, _COMPANY_SUFFIX):
        return False
    pa, pb = _place(a), _place(b)
    if pa and pb and not pa & pb:
        return False
    places = pa | pb

    def title(job: Job) -> str:
        return " ".join(w for w in _norm(job.title, _TITLE_NOISE).split() if w not in places)

    return title(a) == title(b)


def _copy(job: Job) -> Job:
    return replace(job, links=dict(job.links), ids=dict(job.ids), texts=list(job.texts))


def absorb(first: Job, other: Job) -> None:
    """Folds a duplicate listing into `first`: links, ids and texts kept, gaps filled, the longer text shown."""
    for source, url in other.links.items():
        first.links.setdefault(source, url)
    for source, job_id in other.ids.items():
        first.ids.setdefault(source, job_id)
    first.texts += [t for t in other.texts if t not in first.texts]
    if len(other.description) > len(first.description):
        first.description, first.full = other.description, other.full
    if first.salary_min is None and first.salary_max is None:
        first.salary_min, first.salary_max, first.salary_note = other.salary_min, other.salary_max, other.salary_note
    first.posted = max(filter(None, (first.posted, other.posted)), default=None)
    first.expires = max(filter(None, (first.expires, other.expires)), default=None)
    if RANK[other.freshness] > RANK[first.freshness]:
        first.freshness, first.freshness_note = other.freshness, other.freshness_note


def merge(groups: Sequence[Sequence[Job]]) -> list[Job]:
    """Merges duplicates across sources (and within one); the first listing wins, gaps are filled from the others."""
    merged: list[Job] = []
    for jobs in groups:
        for job in jobs:
            first = next((m for m in merged if same_vacancy(m, job)), None)
            if first is None:
                merged.append(_copy(job))
            else:
                absorb(first, job)
    return sorted(merged, key=lambda j: j.posted.toordinal() if j.posted else 0, reverse=True)


class Budget(Protocol):
    limits: dict[str, int]

    async def take(self, provider: str) -> bool: ...


class QuotaUsedUp(SourceError):
    """Today's request limit for this provider (set in backend/.env) is used up."""


@dataclass
class SearchOutcome:
    jobs: list[Job]
    found: dict[str, int] = field(default_factory=dict)
    """Listings per source before merging."""
    failures: dict[str, str] = field(default_factory=dict)
    """Source label → why it gave nothing (not configured, unreachable, rejected the key…)."""


class JobSearch:
    def __init__(
        self,
        sources: Sequence[JobSource],
        cache_seconds: float = 600.0,
        clock: Callable[[], float] = time.monotonic,
        budget: Budget | None = None,
        failure_seconds: float = 120.0,
    ) -> None:
        self.sources = list(sources)
        self.cache_seconds = cache_seconds
        self.failure_seconds = failure_seconds
        self._clock = clock
        self._budget = budget
        self._cache: dict[tuple[str, str, str, int, int], tuple[float, list[Job]]] = {}
        self._failed: dict[tuple[str, ...], tuple[float, str]] = {}

    async def _spend(self, source: JobSource) -> None:
        """Takes one request of the provider's daily limit, or fails without calling the API."""
        if self._budget is not None and not await self._budget.take(source.name):
            limit = self._budget.limits.get(source.name, 0)
            raise QuotaUsedUp(f"{source.label}: the daily limit of {limit} requests is used up; it resets at midnight UTC")

    def _recent_failure(self, key: tuple[str, ...]) -> str | None:
        failed = self._failed.get(key)
        return failed[1] if failed is not None and failed[0] > self._clock() else None

    @property
    def configured(self) -> bool:
        return any(s.configured for s in self.sources)

    async def _search_one(self, source: JobSource, query: str, location: str, days: int, limit: int) -> list[Job]:
        key = (source.name, " ".join(query.lower().split()), " ".join(location.lower().split()), days, limit)
        cached = self._cache.get(key)
        if cached is not None and cached[0] > self._clock():
            return [_copy(j) for j in cached[1]]
        if (failure := self._recent_failure(tuple(map(str, key)))) is not None:
            raise SourceError(failure)
        try:
            if source.configured:
                await self._spend(source)
            jobs = await source.search(query, location, days, limit)
        except SourceNotConfigured:
            raise
        except SourceError as err:
            record(source.name, str(err))
            self._failed[tuple(map(str, key))] = (self._clock() + self.failure_seconds, str(err))
            raise
        record(source.name, None)
        self._cache[key] = (self._clock() + self.cache_seconds, jobs)
        return [_copy(j) for j in jobs]

    async def search(self, query: str, location: str, days: int, limit: int) -> SearchOutcome:
        results = await asyncio.gather(
            *(self._search_one(s, query, location, days, limit) for s in self.sources), return_exceptions=True
        )
        outcome = SearchOutcome(jobs=[])
        groups: list[list[Job]] = []
        for source, result in zip(self.sources, results, strict=True):
            if isinstance(result, SourceError):
                outcome.failures[source.label] = str(result)
            elif isinstance(result, BaseException):
                raise result
            else:
                outcome.found[source.label] = len(result)
                groups.append(result)
        outcome.jobs = merge(groups)[:limit]
        return outcome

    async def details(self, job: Job) -> tuple[str | None, str | None]:
        """Full text of a vacancy from the first source that lists it and can give more; (text, error)."""
        error = None
        for source in self.sources:
            if source.name not in job.links:
                continue
            listing = job if job.source == source.name else replace(job, source=source.name, source_id=job.ids.get(source.name, ""), url=job.links[source.name])
            key = ("details", source.name, listing.source_id or listing.url)
            try:
                if (failure := self._recent_failure(key)) is not None:
                    raise SourceError(failure)
                if getattr(source, "details_use_api", False):
                    await self._spend(source)
                text = await source.details(listing)
            except SourceError as err:
                record(source.name, str(err))
                if not isinstance(err, SourceGone):
                    self._failed[key] = (self._clock() + self.failure_seconds, str(err))
                error = str(err)
                continue
            finally:
                if listing is not job:
                    job.mark(listing.freshness, listing.freshness_note)
                    job.expires = listing.expires or job.expires
            if job.freshness == EXPIRED:
                return None, None
            if text:
                if listing is not job:
                    job.salary_note = job.salary_note or listing.salary_note
                return text, None
        return None, error
