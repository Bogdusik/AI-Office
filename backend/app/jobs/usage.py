"""Daily request limits of the job APIs (the keys may be shared with other projects of the director).

Every request to a provider's API takes one unit of that provider's limit for the current UTC day; the count lives
in `job_api_usage`, so a restart does not reset it. Taking a unit is one upsert, so parallel searches cannot pass
the limit together.
"""

from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import JobApiUsage


def utc_today() -> date:
    return datetime.now(UTC).date()


class DailyBudget:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        limits: Mapping[str, int],
        today: Callable[[], date] = utc_today,
    ) -> None:
        self._sessions = sessions
        self.limits = dict(limits)
        self._today = today

    async def take(self, provider: str) -> bool:
        """Counts one request; False (and nothing counted) when today's limit is used up."""
        limit = self.limits.get(provider)
        if limit is None:
            return True
        if limit <= 0:
            return False
        upsert = (
            insert(JobApiUsage)
            .values(provider=provider, day=self._today(), requests=1)
            .on_conflict_do_update(
                index_elements=[JobApiUsage.provider, JobApiUsage.day],
                set_={"requests": JobApiUsage.requests + 1},
                where=JobApiUsage.requests < limit,
            )
            .returning(JobApiUsage.requests)
        )
        async with self._sessions() as s:
            counted = (await s.execute(upsert)).scalar_one_or_none()
            await s.commit()
        return counted is not None


async def used_today(session: AsyncSession, provider: str, today: date | None = None) -> int:
    day = today or utc_today()
    used = await session.scalar(select(JobApiUsage.requests).where(JobApiUsage.provider == provider, JobApiUsage.day == day))
    return used or 0
