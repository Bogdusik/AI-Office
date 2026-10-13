"""Job APIs: a daily request limit per provider that survives restarts, and failures not repeated at once (audit P8)."""

from datetime import date

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.jobs import AdzunaSource, JobSearch, ReedSource
from app.jobs.usage import DailyBudget, used_today
from app.services.server_room import job_sources
from tests.test_jobs import ADZUNA_ID, ADZUNA_KEY, REED_KEY, Api, adzuna_item, reed_item

DAY = date(2026, 10, 13)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def sources(adzuna: Api, reed: Api) -> list:
    return [
        AdzunaSource(SecretStr(ADZUNA_ID), SecretStr(ADZUNA_KEY), 2, transport=adzuna.transport()),
        ReedSource(SecretStr(REED_KEY), 2, transport=reed.transport()),
    ]


async def test_the_daily_limit_is_counted_in_the_database(session_factory: async_sessionmaker[AsyncSession]) -> None:
    budget = DailyBudget(session_factory, {"adzuna": 2, "reed": 0}, today=lambda: DAY)
    assert [await budget.take("adzuna") for _ in range(3)] == [True, True, False]
    assert await budget.take("reed") is False
    assert await budget.take("other") is True

    after_restart = DailyBudget(session_factory, {"adzuna": 2}, today=lambda: DAY)
    assert await after_restart.take("adzuna") is False
    next_day = DailyBudget(session_factory, {"adzuna": 2}, today=lambda: date(2026, 10, 14))
    assert await next_day.take("adzuna") is True
    async with session_factory() as s:
        assert await used_today(s, "adzuna", DAY) == 2


async def test_a_used_up_provider_is_not_called_and_the_agent_is_told(session_factory: async_sessionmaker[AsyncSession]) -> None:
    adzuna = Api({"results": [adzuna_item(1, "Junior Python Developer", "Acme", "Leeds")]})
    reed = Api({"results": [reed_item(1, "Graduate Developer", "Beta", "Leeds")]})
    budget = DailyBudget(session_factory, {"adzuna": 1, "reed": 100}, today=lambda: DAY)
    search = JobSearch(sources(adzuna, reed), budget=budget)

    first = await search.search("python", "Leeds", 14, 20)
    second = await search.search("backend", "Leeds", 14, 20)

    assert len(adzuna.requests) == 1 and len(reed.requests) == 2
    assert first.found == {"Adzuna": 1, "Reed": 1}
    assert "Adzuna" not in second.found and "daily limit of 1 requests is used up" in second.failures["Adzuna"]


async def test_a_failed_request_is_not_repeated_at_once() -> None:
    adzuna = Api(429)
    reed = Api({"results": []})
    clock = Clock()
    search = JobSearch(sources(adzuna, reed), clock=clock, failure_seconds=120)

    one = await search.search("python", "Leeds", 14, 20)
    two = await search.search("python", "Leeds", 14, 20)
    assert len(adzuna.requests) == 1
    assert one.failures["Adzuna"] == two.failures["Adzuna"] == "Adzuna: request limit reached (HTTP 429)"

    clock.now += 121
    await search.search("python", "Leeds", 14, 20)
    assert len(adzuna.requests) == 2


async def test_reed_adverts_count_against_the_limit(session_factory: async_sessionmaker[AsyncSession]) -> None:
    reed = Api(lambda request: {"results": [reed_item(1, "Graduate Developer", "Beta", "Leeds")]} if "search" in request.url.path else {"jobId": 5001, "jobDescription": "<p>Full advert text.</p>"})
    budget = DailyBudget(session_factory, {"adzuna": 100, "reed": 2}, today=lambda: DAY)
    search = JobSearch(sources(Api({"results": []}), reed), budget=budget)
    outcome = await search.search("graduate", "Leeds", 14, 20)
    text, error = await search.details(outcome.jobs[0])
    assert text and error is None
    assert len(reed.requests) == 2
    again, error = await search.details(outcome.jobs[0])
    assert again is None and error is not None and "daily limit" in error
    assert len(reed.requests) == 2


async def test_the_server_room_shows_todays_count(session_factory: async_sessionmaker[AsyncSession]) -> None:
    budget = DailyBudget(session_factory, {"adzuna": 100})
    for _ in range(3):
        await budget.take("adzuna")
    settings = Settings(database_url="postgresql+asyncpg://x/y", adzuna_app_id=SecretStr("a"), adzuna_app_key=SecretStr("b"), adzuna_daily_limit=100, reed_daily_limit=50)
    async with session_factory() as s:
        rows = {r.name: r for r in await job_sources(s, settings)}
    assert (rows["adzuna"].used_today, rows["adzuna"].daily_limit) == (3, 100)
    assert (rows["reed"].used_today, rows["reed"].daily_limit) == (0, 50)
