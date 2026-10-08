import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.events import Event, bus
from app.executor import Executor, FakeWorker, StageInput, StageOutput, Timings
from app.executor.worker import StageReport
from app.models import Agent, Artifact, Run, Task
from app.models.enums import AgentStatus, RunProvider, RunStatus, TaskStage, TaskStatus
from tests.conftest import Factory
from tests.llm_fixtures import RecordingReport, stage_input

FAST = Timings(arrive=0, depart=0, tick=0.05)
P, R, D, C = TaskStage.PLAN, TaskStage.RESEARCH, TaskStage.DRAFT, TaskStage.SELF_CHECK


class ScriptedWorker(FakeWorker):
    """Fake work with zero delay; tests can hold a stage until released or make it fail."""

    def __init__(self) -> None:
        super().__init__(0)
        self.inputs: list[StageInput] = []
        self.gates: dict[tuple[int, TaskStage], asyncio.Event] = {}
        self.failing: set[tuple[int, TaskStage]] = set()

    def hold(self, task_id: int, stage: TaskStage) -> None:
        self.gates[(task_id, stage)] = asyncio.Event()

    def release(self, task_id: int, stage: TaskStage) -> None:
        self.gates.pop((task_id, stage)).set()

    def started(self, task_id: int, stage: TaskStage) -> bool:
        return any(i.task.id == task_id and i.stage == stage for i in self.inputs)

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        self.inputs.append(data)
        key = (data.task.id, data.stage)
        if key in self.failing:
            raise RuntimeError("boom")
        if gate := self.gates.get(key):
            await gate.wait()
        return await super().run(data, report)


async def until(check: Callable[[], Awaitable[bool] | bool], timeout: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        result = check()
        if isinstance(result, Awaitable):
            result = await result
        if result:
            return
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached in time")
        await asyncio.sleep(0.02)


class World:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self.sessions = sessions

    async def task(self, task_id: int) -> Task:
        async with self.sessions() as s:
            return await s.get_one(Task, task_id)

    async def task_status(self, task_id: int) -> TaskStatus:
        return (await self.task(task_id)).status

    async def agent_status(self, agent_id: int) -> AgentStatus:
        async with self.sessions() as s:
            return (await s.get_one(Agent, agent_id)).status

    async def runs(self, task_id: int) -> list[Run]:
        async with self.sessions() as s:
            return list((await s.scalars(select(Run).where(Run.task_id == task_id).order_by(Run.id))).all())

    async def artifacts(self, task_id: int) -> list[Artifact]:
        async with self.sessions() as s:
            return list(
                (await s.scalars(select(Artifact).where(Artifact.task_id == task_id).order_by(Artifact.version))).all()
            )

    def is_task(self, task_id: int, status: TaskStatus) -> Callable[[], Awaitable[bool]]:
        async def check() -> bool:
            return await self.task_status(task_id) == status

        return check

    def is_agent(self, agent_id: int, status: AgentStatus) -> Callable[[], Awaitable[bool]]:
        async def check() -> bool:
            return await self.agent_status(agent_id) == status

        return check


@pytest.fixture
def world(session_factory: async_sessionmaker[AsyncSession]) -> World:
    return World(session_factory)


@pytest.fixture
async def start_executor(
    session_factory: async_sessionmaker[AsyncSession], engine: AsyncEngine
) -> AsyncIterator[Callable[..., Awaitable[Executor]]]:
    running: list[Executor] = []

    async def _start(worker: FakeWorker, *, wait_active: bool = True) -> Executor:
        executor = Executor(session_factory, engine, worker, FAST)
        await executor.start()
        running.append(executor)
        if wait_active:
            await until(lambda: executor.active)
        return executor

    yield _start
    for executor in running:
        await executor.stop()


@pytest.fixture
async def agent_events() -> AsyncIterator[list[Event]]:
    seen: list[Event] = []

    async def collect() -> None:
        async with bus.subscribe() as queue:
            while True:
                seen.append(await queue.get())

    collector = asyncio.create_task(collect())
    await asyncio.sleep(0)
    yield seen
    collector.cancel()


def statuses(events: list[Event], agent_id: int) -> list[str]:
    return [e.data["status"] for e in events if e.type == "agent" and e.data["id"] == agent_id]


@pytest.fixture
async def floor(make_floor: Factory) -> dict[str, Any]:
    return await make_floor()


@pytest.mark.parametrize(("web_access", "stages"), [(False, [P, D, C]), (True, [P, R, D, C])])
async def test_full_cycle(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
    web_access: bool,
    stages: list[TaskStage],
) -> None:
    agent = await make_agent(floor["id"], web_access=web_access)
    task = await make_task(agent["id"], title="Обзор рынка", description="Коротко")
    await start_executor(ScriptedWorker())

    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))

    runs = await world.runs(task["id"])
    assert [r.stage for r in runs] == stages
    assert all(r.status == RunStatus.SUCCEEDED and r.provider == RunProvider.FAKE and r.attempt == 1 for r in runs)
    assert all(r.finished_at is not None and r.finished_at >= r.started_at for r in runs)
    assert all(r.output and r.input_tokens > 0 and r.output_tokens > 0 for r in runs)
    [artifact] = await world.artifacts(task["id"])
    assert artifact.version == 1
    assert artifact.content == runs[-1].output
    assert "Обзор рынка" in artifact.content
    assert (await world.task(task["id"])).stage == C

    assert (await client.post(f"/api/v1/tasks/{task['id']}/approve")).status_code == 200
    await until(world.is_agent(agent["id"], AgentStatus.OFF_SITE))
    assert statuses(agent_events, agent["id"]) == ["arriving", "idle", "working", "waiting_review", "leaving", "off_site"]


async def test_request_changes_produces_second_version(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"], web_access=True)
    task = await make_task(agent["id"])
    worker = ScriptedWorker()
    await start_executor(worker)
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    res = await client.post(f"/api/v1/tasks/{task['id']}/request-changes", json={"body": "Добавь источники"})
    assert res.status_code == 200
    await until(lambda: _versions(world, task["id"], 2))
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    second = [r for r in await world.runs(task["id"]) if r.attempt == 2]
    assert [r.stage for r in second] == [R, D, C]
    rework = [i for i in worker.inputs if i.version == 2]
    assert all([c.body for c in i.comments] == ["Добавь источники"] for i in rework)
    assert all(len(i.previous_results) == 1 for i in rework)
    v1, v2 = await world.artifacts(task["id"])
    assert "Добавь источники" in v2.content and v1.content != v2.content


async def _versions(world: World, task_id: int, n: int) -> bool:
    return len(await world.artifacts(task_id)) == n


async def test_rework_goes_before_the_queue(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    first = await make_task(agent["id"])
    worker = ScriptedWorker()
    await start_executor(worker)
    await until(world.is_task(first["id"], TaskStatus.NEEDS_REVIEW))

    second = await make_task(agent["id"])
    worker.hold(second["id"], P)
    await until(lambda: worker.started(second["id"], P))
    await client.post(f"/api/v1/tasks/{first['id']}/request-changes", json={"body": "Ещё раз"})
    worker.release(second["id"], P)

    await until(world.is_task(first["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_task(second["id"], TaskStatus.NEEDS_REVIEW))
    order = [(i.task.id, i.version) for i in worker.inputs if i.stage == D]
    assert order == [(first["id"], 1), (second["id"], 1), (first["id"], 2)]


async def test_cancel_stops_work_at_once(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    doomed = await make_task(agent["id"])
    nxt = await make_task(agent["id"])
    worker = ScriptedWorker()
    worker.hold(doomed["id"], P)
    await start_executor(worker)
    await until(lambda: worker.started(doomed["id"], P))

    assert (await client.post(f"/api/v1/tasks/{doomed['id']}/cancel")).status_code == 200
    await until(world.is_task(nxt["id"], TaskStatus.NEEDS_REVIEW))

    [run] = await world.runs(doomed["id"])
    assert (run.stage, run.status) == (P, RunStatus.CANCELLED)
    assert await world.artifacts(doomed["id"]) == []
    assert await world.task_status(doomed["id"]) == TaskStatus.CANCELLED


async def test_pause_waits_for_stage_boundary_and_resume_continues(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    paused = await make_task(agent["id"])
    other = await make_task(agent["id"])
    worker = ScriptedWorker()
    worker.hold(paused["id"], P)
    await start_executor(worker)
    await until(lambda: worker.started(paused["id"], P))

    assert (await client.post(f"/api/v1/tasks/{paused['id']}/pause")).json()["status"] == "paused"
    worker.release(paused["id"], P)
    await until(world.is_task(other["id"], TaskStatus.NEEDS_REVIEW))
    assert [(r.stage, r.status) for r in await world.runs(paused["id"])] == [(P, RunStatus.SUCCEEDED)]
    assert await world.task_status(paused["id"]) == TaskStatus.PAUSED
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))

    assert (await client.post(f"/api/v1/tasks/{paused['id']}/resume")).json()["status"] == "queued"
    await until(world.is_task(paused["id"], TaskStatus.NEEDS_REVIEW))
    assert [r.stage for r in await world.runs(paused["id"])] == [P, D, C]
    resumed_draft = next(i for i in worker.inputs if i.task.id == paused["id"] and i.stage == D)
    assert list(resumed_draft.previous_stages) == [P]


async def test_only_paused_tasks_keep_the_agent_idle_on_site(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    worker = ScriptedWorker()
    worker.hold(task["id"], P)
    await start_executor(worker)
    await until(lambda: worker.started(task["id"], P))
    await client.post(f"/api/v1/tasks/{task['id']}/pause")
    worker.release(task["id"], P)

    await until(world.is_agent(agent["id"], AgentStatus.IDLE))
    await asyncio.sleep(0.3)
    assert await world.agent_status(agent["id"]) == AgentStatus.IDLE


async def test_comment_during_work_reaches_the_next_stage(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    worker = ScriptedWorker()
    worker.hold(task["id"], P)
    await start_executor(worker)
    await until(lambda: worker.started(task["id"], P))

    await client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "Пиши короче"})
    worker.release(task["id"], P)
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    seen = {i.stage: [c.body for c in i.comments] for i in worker.inputs}
    assert seen[P] == []
    assert seen[D] == seen[C] == ["Пиши короче"]


async def test_stage_error_fails_task_and_agent_moves_on(
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    broken = await make_task(agent["id"])
    fine = await make_task(agent["id"])
    worker = ScriptedWorker()
    worker.failing.add((broken["id"], D))
    await start_executor(worker)

    await until(world.is_task(fine["id"], TaskStatus.NEEDS_REVIEW))
    assert await world.task_status(broken["id"]) == TaskStatus.FAILED
    runs = await world.runs(broken["id"])
    assert [(r.stage, r.status) for r in runs] == [(P, RunStatus.SUCCEEDED), (D, RunStatus.FAILED)]
    assert runs[-1].error == "RuntimeError: boom"
    assert (await world.task(broken["id"])).finished_at is not None


async def test_recovers_after_restart_from_current_stage(
    db: AsyncSession,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    started = datetime.now(UTC)
    db_agent = await db.get_one(Agent, agent["id"])
    db_task = await db.get_one(Task, task["id"])
    db_agent.status = AgentStatus.WORKING
    db_task.status, db_task.stage, db_task.started_at = TaskStatus.IN_PROGRESS, D, started
    db.add_all(
        [
            Run(task_id=task["id"], stage=P, attempt=1, provider=RunProvider.FAKE, status=RunStatus.SUCCEEDED,
                output="план", started_at=started, finished_at=started),
            Run(task_id=task["id"], stage=D, attempt=1, provider=RunProvider.FAKE, status=RunStatus.RUNNING,
                started_at=started),
        ]
    )
    await db.commit()

    worker = ScriptedWorker()
    await start_executor(worker)
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    runs = await world.runs(task["id"])
    assert [(r.stage, r.status) for r in runs] == [
        (P, RunStatus.SUCCEEDED),
        (D, RunStatus.INTERRUPTED),
        (D, RunStatus.SUCCEEDED),
        (C, RunStatus.SUCCEEDED),
    ]
    assert [i.stage for i in worker.inputs] == [D, C]
    assert worker.inputs[0].previous_stages == {P: "план"}
    assert (await world.task(task["id"])).started_at == started
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))


async def test_agents_work_in_parallel(
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    a = await make_agent(floor["id"])
    b = await make_agent(floor["id"])
    ta = await make_task(a["id"])
    tb = await make_task(b["id"])
    worker = ScriptedWorker()
    worker.hold(ta["id"], P)
    worker.hold(tb["id"], P)
    await start_executor(worker)

    await until(lambda: worker.started(ta["id"], P) and worker.started(tb["id"], P))
    assert await world.task_status(ta["id"]) == await world.task_status(tb["id"]) == TaskStatus.IN_PROGRESS
    assert await world.agent_status(a["id"]) == await world.agent_status(b["id"]) == AgentStatus.WORKING

    worker.release(ta["id"], P)
    worker.release(tb["id"], P)
    await until(world.is_task(ta["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_task(tb["id"], TaskStatus.NEEDS_REVIEW))


async def test_one_task_at_a_time_in_queue_order(
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    tasks = [await make_task(agent["id"]) for _ in range(3)]
    worker = ScriptedWorker()
    await start_executor(worker)
    for t in tasks:
        await until(world.is_task(t["id"], TaskStatus.NEEDS_REVIEW))

    order = [i.task.id for i in worker.inputs]
    assert order == [t["id"] for t in tasks for _ in (P, D, C)]


async def test_agent_stays_while_something_awaits_review(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    first = await make_task(agent["id"])
    second = await make_task(agent["id"])
    await start_executor(ScriptedWorker())
    await until(world.is_task(second["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))

    await client.post(f"/api/v1/tasks/{first['id']}/approve")
    await asyncio.sleep(0.3)
    assert await world.agent_status(agent["id"]) == AgentStatus.WAITING_REVIEW

    await client.post(f"/api/v1/tasks/{second['id']}/cancel")
    await until(world.is_agent(agent["id"], AgentStatus.OFF_SITE))


async def test_only_one_executor_runs_per_database(
    start_executor: Callable[..., Awaitable[Executor]],
) -> None:
    first = await start_executor(ScriptedWorker())
    second = await start_executor(ScriptedWorker(), wait_active=False)
    await asyncio.sleep(0.3)
    assert first.active and not second.active

    await first.stop()
    await until(lambda: second.active)


async def test_new_task_brings_an_agent_back_after_leaving(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    agent_events: list[Event],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    await start_executor(ScriptedWorker())
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await client.post(f"/api/v1/tasks/{task['id']}/approve")
    await until(world.is_agent(agent["id"], AgentStatus.OFF_SITE))

    again = await make_task(agent["id"])
    await until(world.is_task(again["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))
    assert statuses(agent_events, agent["id"])[-4:] == ["arriving", "idle", "working", "waiting_review"]


async def test_fake_worker_streams_its_text() -> None:
    report = RecordingReport()

    out = await FakeWorker(0).run(stage_input(), report)

    assert report.events == ["started"]
    assert len(report.partials) > 1
    assert all(b.startswith(a) for a, b in zip(report.partials, report.partials[1:], strict=False))
    assert report.partials[-1] == out.text


async def test_a_failed_task_is_retried_from_the_stage_that_failed(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    other = await make_task(agent["id"], title="queued meanwhile")
    worker = ScriptedWorker()
    worker.failing.add((task["id"], D))
    worker.hold(other["id"], P)
    await start_executor(worker)
    await until(world.is_task(task["id"], TaskStatus.FAILED))
    assert (await client.post(f"/api/v1/tasks/{other['id']}/retry")).status_code == 409

    worker.failing.clear()
    res = await client.post(f"/api/v1/tasks/{task['id']}/retry")

    assert res.status_code == 200 and res.json()["status"] in ("queued", "in_progress")
    assert res.json()["finished_at"] is None
    worker.release(other["id"], P)
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    runs = await world.runs(task["id"])
    assert [(r.stage, r.status) for r in runs] == [
        (P, RunStatus.SUCCEEDED),
        (D, RunStatus.FAILED),
        (D, RunStatus.SUCCEEDED),
        (C, RunStatus.SUCCEEDED),
    ]
    assert len(await world.artifacts(task["id"])) == 1

