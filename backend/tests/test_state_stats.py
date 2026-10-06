from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task
from app.services import tasks as task_service
from app.services.state import build_state, start_of_local_day
from tests.conftest import Factory


async def _done(db: AsyncSession, task_id: int) -> None:
    await task_service.start(db, task_id)
    await task_service.submit_for_review(db, task_id)
    await task_service.approve(db, task_id)


async def test_stats_on_empty_world(client: AsyncClient) -> None:
    res = await client.get("/api/v1/state")
    assert res.status_code == 200
    assert res.json()["stats"] == {"tasks_in_progress": 0, "awaiting_review": 0, "done_today": 0}


async def test_stats_count_tasks_by_status(
    client: AsyncClient, db: AsyncSession, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    a = await make_agent(floor["id"])
    b = await make_agent(floor["id"])

    await make_task(a["id"])
    working_a = await make_task(a["id"])
    working_b = await make_task(b["id"])
    review = await make_task(b["id"])
    done = await make_task(a["id"])
    cancelled = await make_task(b["id"])

    await task_service.start(db, working_a["id"])
    await task_service.start(db, working_b["id"])
    await task_service.start(db, review["id"])
    await task_service.submit_for_review(db, review["id"])
    await _done(db, done["id"])
    await task_service.cancel(db, cancelled["id"])

    stats = (await client.get("/api/v1/state")).json()["stats"]
    assert stats == {"tasks_in_progress": 2, "awaiting_review": 1, "done_today": 1}


async def test_done_today_ignores_earlier_days(
    db: AsyncSession, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    today = await make_task(agent["id"])
    yesterday = await make_task(agent["id"])
    await _done(db, today["id"])
    await _done(db, yesterday["id"])

    now = datetime.now().astimezone()
    midnight = start_of_local_day(now)
    await db.execute(
        update(Task).where(Task.id == yesterday["id"]).values(finished_at=midnight - timedelta(seconds=1))
    )
    await db.commit()

    assert (await build_state(db, now)).stats.done_today == 1
    assert (await build_state(db, now + timedelta(days=1))).stats.done_today == 0


def test_start_of_local_day() -> None:
    now = datetime(2026, 10, 6, 15, 30).astimezone()
    start = start_of_local_day(now)
    assert (start.year, start.month, start.day, start.hour, start.minute) == (2026, 10, 6, 0, 0)
    assert start.utcoffset() == now.utcoffset()
