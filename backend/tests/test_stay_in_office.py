import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.events import Event
from app.executor import Executor, Timings
from app.models import Agent, Task
from app.models.enums import AgentStatus, TaskStage, TaskStatus, TripKind
from tests.conftest import Factory
from tests.test_executor import ScriptedWorker, World, agent_events, statuses, until, world  # noqa: F401 (fixtures)


@pytest.fixture
async def run_executor(
    session_factory: async_sessionmaker[AsyncSession], engine: AsyncEngine
) -> AsyncIterator[Callable[..., Awaitable[Executor]]]:
    running: list[Executor] = []

    async def _start(worker: ScriptedWorker | None = None, **timings: float) -> Executor:
        t = {"arrive": 0.0, "depart": 0.0, "tick": 0.05, **timings}
        executor = Executor(session_factory, engine, worker or ScriptedWorker(), Timings(**t))  # type: ignore[arg-type]
        await executor.start()
        running.append(executor)
        await until(lambda: executor.active)
        return executor

    yield _start
    for executor in running:
        await executor.stop()


async def _set_agent(sessions: async_sessionmaker[AsyncSession], agent_id: int, **values: Any) -> None:
    async with sessions() as s:
        await s.execute(update(Agent).where(Agent.id == agent_id).values(**values))
        await s.commit()


async def _set_task(sessions: async_sessionmaker[AsyncSession], task_id: int, status: TaskStatus) -> None:
    async with sessions() as s:
        await s.execute(update(Task).where(Task.id == task_id).values(status=status))
        await s.commit()


def _state_of(state: dict[str, Any], agent_id: int) -> dict[str, Any]:
    return next(a for f in state["floors"] for a in f["agents"] if a["id"] == agent_id)


async def _in_office(client: AsyncClient, world: World, make_agent: Factory, make_task: Factory, floor_id: int) -> dict[str, Any]:
    """An agent who arrived, did a task and had it accepted: free, in the office."""
    agent = await make_agent(floor_id)
    task = await make_task(agent["id"])
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await client.post(f"/api/v1/tasks/{task['id']}/approve")
    await until(world.is_agent(agent["id"], AgentStatus.IDLE))
    return agent


async def test_the_agent_stays_after_the_last_task_and_takes_a_new_one_without_arriving(
    client: AsyncClient,
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    await run_executor()
    agent = await _in_office(client, world, make_agent, make_task, floor["id"])
    await asyncio.sleep(0.4)
    assert await world.agent_status(agent["id"]) == AgentStatus.IDLE

    again = await make_task(agent["id"])
    await until(world.is_task(again["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))
    assert statuses(agent_events, agent["id"]) == ["arriving", "idle", "working", "waiting_review", "idle", "working", "waiting_review"]


@pytest.mark.parametrize(
    ("task_status", "allowed"),
    [
        (TaskStatus.IN_PROGRESS, False),
        (TaskStatus.QUEUED, False),
        (TaskStatus.CHANGES_REQUESTED, False),
        (TaskStatus.NEEDS_REVIEW, True),
        (TaskStatus.PAUSED, True),
        (TaskStatus.DONE, True),
    ],
)
async def test_release_is_refused_while_the_agent_has_work(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
    task_status: TaskStatus,
    allowed: bool,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    await _set_task(session_factory, task["id"], task_status)
    office = AgentStatus.WAITING_REVIEW if task_status == TaskStatus.NEEDS_REVIEW else AgentStatus.IDLE
    await _set_agent(session_factory, agent["id"], status=office)

    blocked = _state_of((await client.get("/api/v1/state")).json(), agent["id"])["release_blocked"]
    res = await client.post(f"/api/v1/agents/{agent['id']}/release")

    if allowed:
        assert blocked is None
        assert res.status_code == 200 and res.json()["status"] == AgentStatus.LEAVING
    else:
        assert blocked == "tasks"
        assert res.status_code == 409
        assert res.json()["detail"] == "Agent has tasks in progress, queued or with changes requested"


@pytest.mark.parametrize(
    ("status", "reason"),
    [(AgentStatus.OFF_SITE, "away"), (AgentStatus.LEAVING, "away"), (AgentStatus.ARRIVING, "on_the_way"), (AgentStatus.RETURNING, "on_the_way")],
)
async def test_only_an_agent_in_the_office_can_be_released(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    make_floor: Factory,
    make_agent: Factory,
    status: AgentStatus,
    reason: str,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    await _set_agent(session_factory, agent["id"], status=status)

    assert _state_of((await client.get("/api/v1/state")).json(), agent["id"])["release_blocked"] == reason
    assert (await client.post(f"/api/v1/agents/{agent['id']}/release")).status_code == 409


async def test_a_released_agent_drives_home(
    client: AsyncClient,
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    await run_executor(depart=0.3)
    agent = await _in_office(client, world, make_agent, make_task, floor["id"])

    assert (await client.post(f"/api/v1/agents/{agent['id']}/release")).status_code == 200
    await until(world.is_agent(agent["id"], AgentStatus.OFF_SITE))
    assert statuses(agent_events, agent["id"])[-3:] == ["idle", "leaving", "off_site"]
    trip = _state_of((await client.get("/api/v1/state")).json(), agent["id"])["trip"]
    assert (trip["kind"], trip["origin_at"]) == (TripKind.DEPART, None)


async def test_a_task_before_the_car_moves_turns_the_agent_back_to_the_desk(
    client: AsyncClient,
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    await run_executor(depart=10, turn_back=5, return_extra=0.4)
    agent = await _in_office(client, world, make_agent, make_task, floor["id"])
    await client.post(f"/api/v1/agents/{agent['id']}/release")
    await asyncio.sleep(0.3)

    task = await make_task(agent["id"])
    await until(world.is_agent(agent["id"], AgentStatus.RETURNING))
    trip = _state_of((await client.get("/api/v1/state")).json(), agent["id"])["trip"]
    left, turned = datetime.fromisoformat(trip["origin_at"]), datetime.fromisoformat(trip["started_at"])
    assert trip["kind"] == TripKind.RETURN
    assert timedelta(seconds=0.2) < turned - left < timedelta(seconds=1)

    clock = asyncio.get_running_loop().time
    begin = clock()
    await until(world.is_agent(agent["id"], AgentStatus.WORKING), timeout=3)
    # Back at the desk after (time spent leaving) + return_extra, then straight to work.
    assert clock() - begin >= (turned - left).total_seconds() + 0.4 - 0.2
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))
    assert statuses(agent_events, agent["id"])[-5:] == ["leaving", "returning", "idle", "working", "waiting_review"]


async def test_a_task_after_the_car_moved_brings_it_straight_back_from_the_map_edge(
    client: AsyncClient,
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    await run_executor(depart=1.0, turn_back=0.2, arrive=0.3)
    agent = await _in_office(client, world, make_agent, make_task, floor["id"])
    await client.post(f"/api/v1/agents/{agent['id']}/release")
    async with world.sessions() as s:
        left = (await s.get_one(Agent, agent["id"])).trip_started_at
    await asyncio.sleep(0.4)

    task = await make_task(agent["id"])
    await asyncio.sleep(0.2)
    assert await world.agent_status(agent["id"]) == AgentStatus.LEAVING
    await until(world.is_agent(agent["id"], AgentStatus.ARRIVING), timeout=2)
    trip = _state_of((await client.get("/api/v1/state")).json(), agent["id"])["trip"]
    assert trip["kind"] == TripKind.ARRIVE
    assert datetime.fromisoformat(trip["origin_at"]) == left
    assert datetime.fromisoformat(trip["started_at"]) - left >= timedelta(seconds=1.0)

    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))
    assert statuses(agent_events, agent["id"])[-5:] == ["leaving", "arriving", "idle", "working", "waiting_review"]


async def test_release_all_sends_home_who_can_go_and_keeps_the_busy(
    client: AsyncClient,
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    busy = await make_agent(floor["id"])
    busy_task = await make_task(busy["id"])
    worker = ScriptedWorker()
    worker.hold(busy_task["id"], TaskStage.PLAN)
    await run_executor(worker)
    free = await _in_office(client, world, make_agent, make_task, floor["id"])
    reviewing = await make_agent(floor["id"])
    review_task = await make_task(reviewing["id"])
    await until(world.is_agent(reviewing["id"], AgentStatus.WAITING_REVIEW))
    away = await make_agent(floor["id"])
    await until(world.is_agent(busy["id"], AgentStatus.WORKING))

    res = await client.post("/api/v1/agents/release-all")

    assert res.status_code == 200
    assert sorted(res.json()["released"]) == sorted([free["id"], reviewing["id"]])
    assert res.json()["kept"] == {str(busy["id"]): "tasks", str(away["id"]): "away"}
    await until(world.is_agent(free["id"], AgentStatus.OFF_SITE))
    await until(world.is_agent(reviewing["id"], AgentStatus.OFF_SITE))
    assert await world.agent_status(busy["id"]) == AgentStatus.WORKING
    assert await world.task_status(review_task["id"]) == TaskStatus.NEEDS_REVIEW
    assert (await client.post("/api/v1/agents/release-all")).json()["released"] == []


async def test_after_a_restart_everyone_in_the_office_stays_and_trips_finish_on_time(
    session_factory: async_sessionmaker[AsyncSession],
    world: World,
    run_executor: Callable[..., Awaitable[Executor]],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    free = await make_agent(floor["id"])
    reviewing = await make_agent(floor["id"])
    review_task = await make_task(reviewing["id"])
    returning = await make_agent(floor["id"])
    await make_task(returning["id"])
    now = datetime.now(UTC)
    await _set_agent(session_factory, free["id"], status=AgentStatus.IDLE)
    await _set_task(session_factory, review_task["id"], TaskStatus.NEEDS_REVIEW)
    await _set_agent(session_factory, reviewing["id"], status=AgentStatus.WAITING_REVIEW)
    # Turned back 2 s into leaving, 1.9 s ago: 2 + 0.5 − 1.9 = 0.6 s of the return are left.
    left, turned = now - timedelta(seconds=3.9), now - timedelta(seconds=1.9)
    await _set_agent(
        session_factory, returning["id"], status=AgentStatus.RETURNING, status_since=turned,
        trip_kind=TripKind.RETURN, trip_started_at=turned, trip_origin_at=left,
    )

    clock = asyncio.get_running_loop().time
    begin = clock()
    await run_executor(return_extra=0.5)
    await until(world.is_agent(returning["id"], AgentStatus.WORKING), timeout=3)
    assert 0.3 < clock() - begin < 1.5
    await asyncio.sleep(0.3)
    assert await world.agent_status(free["id"]) == AgentStatus.IDLE
    assert await world.agent_status(reviewing["id"]) == AgentStatus.WAITING_REVIEW
