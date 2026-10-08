import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.executor import Executor, Timings
from app.models import Agent
from app.models.enums import AgentStatus, TaskStatus, TripKind
from tests.conftest import Factory
from tests.test_executor import ScriptedWorker, World, start_executor, until, world  # noqa: F401 (fixtures)


def _agent(state: dict[str, Any], agent_id: int) -> dict[str, Any]:
    return next(a for f in state["floors"] for a in f["agents"] if a["id"] == agent_id)


def _at(value: str) -> datetime:
    return datetime.fromisoformat(value)


async def test_state_shows_status_start_trip_and_motion(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    before = await client.get("/api/v1/state")
    assert _agent(before.json(), agent["id"])["trip"] is None
    motion = before.json()["motion"]
    settings = get_settings()
    assert (motion["arrive_seconds"], motion["depart_seconds"], motion["turn_back_seconds"], motion["return_extra_seconds"]) == (
        settings.executor_arrive_seconds,
        settings.executor_depart_seconds,
        settings.executor_turn_back_seconds,
        settings.executor_return_extra_seconds,
    )
    assert abs(_at(motion["server_time"]) - datetime.now(UTC)) < timedelta(seconds=5)

    task = await make_task(agent["id"])
    await start_executor(ScriptedWorker())
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    reviewing = _agent((await client.get("/api/v1/state")).json(), agent["id"])
    assert reviewing["trip"]["kind"] == TripKind.ARRIVE
    assert _at(reviewing["trip"]["started_at"]) <= _at(reviewing["status_since"])

    await client.post(f"/api/v1/tasks/{task['id']}/approve")
    await until(world.is_agent(agent["id"], AgentStatus.IDLE))
    assert (await client.post(f"/api/v1/agents/{agent['id']}/release")).status_code == 200
    await until(world.is_agent(agent["id"], AgentStatus.OFF_SITE))
    gone = _agent((await client.get("/api/v1/state")).json(), agent["id"])
    assert gone["trip"]["kind"] == TripKind.DEPART
    assert _at(reviewing["status_since"]) < _at(gone["trip"]["started_at"]) <= _at(gone["status_since"])


async def test_arrival_resumes_from_its_start_after_a_restart(
    session_factory: async_sessionmaker[AsyncSession],
    engine: AsyncEngine,
    world: World,
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    await make_task(agent["id"])
    started = datetime.now(UTC) - timedelta(seconds=2.6)
    async with session_factory() as s:
        await s.execute(
            update(Agent)
            .where(Agent.id == agent["id"])
            .values(status=AgentStatus.ARRIVING, status_since=started, trip_kind=TripKind.ARRIVE, trip_started_at=started)
        )
        await s.commit()

    executor = Executor(session_factory, engine, ScriptedWorker(), Timings(arrive=3, depart=0, tick=0.05))
    clock = asyncio.get_running_loop().time
    begin = clock()
    await executor.start()
    try:
        await until(world.is_agent(agent["id"], AgentStatus.IDLE), timeout=2)
        assert clock() - begin < 1.5
    finally:
        await executor.stop()
