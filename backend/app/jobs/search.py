"""Search every configured source at once, merge duplicates, cache identical searches for a short time."""

import asyncio
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace

from app.jobs.models import Job, SourceError, SourceNotConfigured
from app.jobs.sources import JobSource, record

_COMPANY_SUFFIX = re.compile(r"\b(?:ltd|limited|plc|llp|inc|group|uk|recruitment)\b")
_TITLE_NOISE = re.compile(r"\(.*?\)|\[.*?\]|\b(?:remote|hybrid|urgent|new)\b")
_NON_WORD = re.compile(r"[^a-z0-9]+")


def _norm(text: str, noise: re.Pattern[str] | None = None) -> str:
    text = text.lower().replace("&", " and ")
    if noise is not None:
        text = noise.sub(" ", text)
    return " ".join(_NON_WORD.sub(" ", text).split())


def dedupe_key(job: Job) -> tuple[str, str, str]:
    """Same company, same title and same town → the same vacancy, whichever site lists it."""
    town = _norm(job.location.split(",")[0])
    return _norm(job.company, _COMPANY_SUFFIX), _norm(job.title, _TITLE_NOISE), town


def _copy(job: Job) -> Job:
    return replace(job, links=dict(job.links), ids=dict(job.ids))


def merge(groups: Sequence[Sequence[Job]]) -> list[Job]:
    """Merges duplicates across sources (and within one); the first listing wins, gaps are filled from the others."""
    merged: dict[tuple[str, str, str], Job] = {}
    for jobs in groups:
        for job in jobs:
            key = dedupe_key(job)
            first = merged.get(key)
            if first is None:
                merged[key] = _copy(job)
                continue
            for source, url in job.links.items():
                first.links.setdefault(source, url)
            for source, job_id in job.ids.items():
                first.ids.setdefault(source, job_id)
            if len(job.description) > len(first.description):
                first.description, first.full = job.description, job.full
            if first.salary_min is None and first.salary_max is None:
                first.salary_min, first.salary_max, first.salary_note = job.salary_min, job.salary_max, job.salary_note
            first.posted = max(filter(None, (first.posted, job.posted)), default=None)
    return sorted(merged.values(), key=lambda j: j.posted.toordinal() if j.posted else 0, reverse=True)


@dataclass
class SearchOutcome:
    jobs: list[Job]
    found: dict[str, int] = field(default_factory=dict)
    """Listings per source before merging."""
    failures: dict[str, str] = field(default_factory=dict)
    """Source label → why it gave nothing (not configured, unreachable, rejected the key…)."""


class JobSearch:
    def __init__(self, sources: Sequence[JobSource], cache_seconds: float = 600.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.sources = list(sources)
        self.cache_seconds = cache_seconds
        self._clock = clock
        self._cache: dict[tuple[str, str, str, int, int], tuple[float, list[Job]]] = {}

    @property
    def configured(self) -> bool:
        return any(s.configured for s in self.sources)

    async def _search_one(self, source: JobSource, query: str, location: str, days: int, limit: int) -> list[Job]:
        key = (source.name, " ".join(query.lower().split()), " ".join(location.lower().split()), days, limit)
        cached = self._cache.get(key)
        if cached is not None and cached[0] > self._clock():
            return [_copy(j) for j in cached[1]]
        try:
            jobs = await source.search(query, location, days, limit)
        except SourceNotConfigured:
            raise
        except SourceError as err:
            record(source.name, str(err))
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
            try:
                text = await source.details(listing)
            except SourceError as err:
                record(source.name, str(err))
                error = str(err)
                continue
            if text:
                if listing is not job:
                    job.salary_note = job.salary_note or listing.salary_note
                return text, None
        return None, error
