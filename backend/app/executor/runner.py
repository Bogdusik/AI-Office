"""Background executor: moves agents through their day and tasks through their stages.

One supervisor loop keeps one asyncio worker per agent that has something to do, so agents work in parallel
and each one handles a single task at a time. All state lives in the database: every step is a short
transaction that re-checks the current status under `SELECT ... FOR UPDATE`, so the director's actions
(pause, cancel, request changes) always win, and a restart simply resumes from what the rows say.
A Postgres advisory lock makes sure only one executor runs against a database.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker

from app.events import Event, EventBus, publish_agent, publish_artifact, publish_task
from app.events import bus as default_bus
from app.executor.worker import (
    AgentSnapshot,
    CommentSnapshot,
    ProfileSnapshot,
    StageInput,
    StageOutput,
    StageWorker,
    TaskSnapshot,
)
from app.models import Agent, Artifact, Profile, Run, Task, TaskComment
from app.models.enums import AgentStatus, RunStatus, TaskStage, TaskStatus
from app.models.profile import PROFILE_ID
from app.services import rules
from app.services.tasks import apply_transition

log = logging.getLogger(__name__)

LOCK_KEY = 0x4149_4F46
"""pg advisory lock id ("AIOF"): one executor per database."""

WORKABLE = frozenset(rules.EXECUTOR_PICK_ORDER)


@dataclass(frozen=True)
class Timings:
    arrive: float
    depart: float
    tick: float
    """Fallback re-check interval; events usually wake things up sooner."""


class _Cancelled:
    pass


CANCELLED = _Cancelled()

def now() -> datetime:
    return datetime.now(UTC)


class Executor:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        engine: AsyncEngine,
        worker: StageWorker,
        timings: Timings,
        bus: EventBus = default_bus,
    ) -> None:
        self._sessions = sessions
        self._engine = engine
        self._worker = worker
        self._t = timings
        self._bus = bus
        self._workers: dict[int, asyncio.Task[None]] = {}
        self._pokes: dict[int, asyncio.Event] = {}
        self._stop = asyncio.Event()
        self._main: asyncio.Task[None] | None = None
        self.active = False
        """True while this instance holds the lock and runs agents."""

    # ---------- lifecycle ----------

    async def start(self) -> None:
        self._stop = asyncio.Event()
        self._main = asyncio.create_task(self._run(), name="executor")

    async def stop(self) -> None:
        self._stop.set()
        if self._main is not None:
            await asyncio.gather(self._main, return_exceptions=True)
            self._main = None

    async def _run(self) -> None:
        async with self._engine.connect() as conn:
            while not await self._try_lock(conn):
                if await self._sleep(self._t.tick):
                    return
            self.active = True
            try:
                await self._recover()
                async with self._bus.subscribe() as events:
                    while not self._stop.is_set():
                        await self._sync_workers()
                        await self._next_events(events)
            except Exception:
                log.exception("executor crashed")
                raise
            finally:
                self.active = False
                for worker in self._workers.values():
                    worker.cancel()
                await asyncio.gather(*self._workers.values(), return_exceptions=True)
                self._workers.clear()
                await conn.scalar(select(func.pg_advisory_unlock(LOCK_KEY)))
                await conn.commit()

    @staticmethod
    async def _try_lock(conn: AsyncConnection) -> bool:
        locked = await conn.scalar(select(func.pg_try_advisory_lock(LOCK_KEY)))
        await conn.commit()
        return bool(locked)

    async def _recover(self) -> None:
        """Runs left `running` by a crash or restart are marked interrupted; their stage runs again."""
        async with self._sessions() as s:
            await s.execute(
                update(Run)
                .where(Run.status == RunStatus.RUNNING)
                .values(status=RunStatus.INTERRUPTED, finished_at=now(), error="Interrupted by a server restart")
            )
            await s.commit()

    async def _sync_workers(self) -> None:
        async with self._sessions() as s:
            busy = select(Task.agent_id).where(Task.status.in_(WORKABLE))
            ids = (
                await s.scalars(
                    select(Agent.id).where(
                        Agent.archived_at.is_(None),
                        or_(Agent.status != AgentStatus.OFF_SITE, Agent.id.in_(busy)),
                    )
                )
            ).all()
        for agent_id, worker in list(self._workers.items()):
            if worker.done():
                del self._workers[agent_id]
                if not worker.cancelled() and worker.exception() is not None:
                    log.error("agent %s worker failed", agent_id, exc_info=worker.exception())
        for agent_id in ids:
            if agent_id not in self._workers:
                self._workers[agent_id] = asyncio.create_task(self._agent_loop(agent_id), name=f"agent-{agent_id}")

    async def _next_events(self, events: asyncio.Queue[Event]) -> None:
        try:
            self._route(await asyncio.wait_for(events.get(), self._t.tick))
        except TimeoutError:
            return
        while not events.empty():
            self._route(events.get_nowait())

    def _route(self, event: Event) -> None:
        agent_id = event.data.get("id") if event.type == "agent" else event.data.get("agent_id")
        if isinstance(agent_id, int):
            self._poke(agent_id).set()

    def _poke(self, agent_id: int) -> asyncio.Event:
        return self._pokes.setdefault(agent_id, asyncio.Event())

    async def _sleep(self, seconds: float) -> bool:
        """Sleeps unless the executor stops first; True means stop."""
        try:
            await asyncio.wait_for(self._stop.wait(), max(seconds, 0))
            return True
        except TimeoutError:
            return self._stop.is_set()

    async def _wait_poke(self, agent_id: int) -> None:
        try:
            await asyncio.wait_for(self._poke(agent_id).wait(), self._t.tick)
        except TimeoutError:
            pass

    # ---------- agent lifecycle ----------

    async def _agent_loop(self, agent_id: int) -> None:
        while not self._stop.is_set():
            self._poke(agent_id).clear()
            loaded = await self._load(agent_id)
            if loaded is None:
                return
            status, tasks = loaded
            nxt = rules.pick_next_task(tasks)

            if status == AgentStatus.OFF_SITE:
                if nxt is None:
                    return
                await self._set_status(agent_id, AgentStatus.ARRIVING)
            elif status == AgentStatus.ARRIVING:
                if await self._sleep(self._t.arrive):
                    return
                await self._set_status(agent_id, AgentStatus.IDLE)
            elif status == AgentStatus.LEAVING:
                if await self._sleep(self._t.depart):
                    return
                await self._set_status(agent_id, AgentStatus.OFF_SITE)
            elif nxt is not None:
                await self._work(agent_id, nxt.id)
            elif any(t.status == TaskStatus.NEEDS_REVIEW for t in tasks):
                await self._set_status(agent_id, AgentStatus.WAITING_REVIEW)
                await self._wait_poke(agent_id)
            elif any(t.status == TaskStatus.PAUSED for t in tasks):
                await self._set_status(agent_id, AgentStatus.IDLE)
                await self._wait_poke(agent_id)
            else:
                await self._set_status(agent_id, AgentStatus.LEAVING)

    async def _load(self, agent_id: int) -> tuple[AgentStatus, list[Task]] | None:
        async with self._sessions() as s:
            agent = await s.scalar(
                select(Agent).where(Agent.id == agent_id).execution_options(populate_existing=True)
            )
            if agent is None or agent.archived_at is not None:
                return None
            tasks = (
                await s.scalars(
                    select(Task).where(Task.agent_id == agent_id, Task.status.in_(rules.ACTIVE_STATUSES))
                )
            ).all()
            return agent.status, list(tasks)

    async def _set_status(self, agent_id: int, status: AgentStatus) -> None:
        async with self._sessions() as s:
            agent = await s.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
            if agent is None or agent.archived_at is not None or agent.status == status:
                return
            agent.status = status
            await s.commit()
        publish_agent(agent_id, status)

    # ---------- task work ----------

    async def _work(self, agent_id: int, task_id: int) -> None:
        started = await self._start_task(agent_id, task_id)
        if started is None:
            return
        agent, version = started
        await self._set_status(agent_id, AgentStatus.WORKING)
        stages = rules.task_stages(web_access=agent.web_access, version=version)

        while not self._stop.is_set():
            begun = await self._begin_stage(task_id, stages, version, agent)
            if begun is None:
                return
            if isinstance(begun, str):
                await self._finish(task_id, version)
                return
            run_id, data = begun
            outcome = await self._execute(agent_id, task_id, data)
            await self._record(task_id, run_id, outcome)
            if not isinstance(outcome, StageOutput):
                return

    async def _lock_task(self, s: AsyncSession, task_id: int) -> Task | None:
        return await s.scalar(
            select(Task).where(Task.id == task_id).with_for_update().execution_options(populate_existing=True)
        )

    async def _start_task(self, agent_id: int, task_id: int) -> tuple[AgentSnapshot, int] | None:
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.agent_id != agent_id or task.status not in WORKABLE:
                return None
            moved = task.status != TaskStatus.IN_PROGRESS
            if moved:
                apply_transition(task, TaskStatus.IN_PROGRESS, now())
            agent = await s.get_one(Agent, agent_id)
            versions = await s.scalar(select(func.count()).select_from(Artifact).where(Artifact.task_id == task_id))
            snapshot = AgentSnapshot(
                id=agent.id,
                name=agent.name,
                title=agent.title,
                system_prompt=agent.system_prompt,
                model=agent.model,
                web_access=agent.web_access,
            )
            await s.commit()
        if moved:
            publish_task(task)
        return snapshot, (versions or 0) + 1

    async def _begin_stage(
        self, task_id: int, stages: tuple[TaskStage, ...], version: int, agent: AgentSnapshot
    ) -> tuple[int, StageInput] | Literal["finished"] | None:
        """Picks the next stage of this version and opens a run for it. A task that left `in_progress`
        (paused, cancelled, put back in the queue) stops here — that is the stage boundary."""
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.status != TaskStatus.IN_PROGRESS:
                return None
            done_runs = (
                await s.scalars(
                    select(Run)
                    .where(Run.task_id == task_id, Run.attempt == version, Run.status == RunStatus.SUCCEEDED)
                    .order_by(Run.id)
                )
            ).all()
            stage = rules.next_stage(stages, (r.stage for r in done_runs))
            if stage is None:
                return "finished"

            changed = task.stage != stage
            task.stage = stage
            run = Run(
                task_id=task_id,
                stage=stage,
                attempt=version,
                provider=self._worker.provider,
                model=self._worker.model,
                status=RunStatus.RUNNING,
                started_at=now(),
            )
            s.add(run)
            profile = await s.get(Profile, PROFILE_ID)
            comments = (
                await s.scalars(select(TaskComment).where(TaskComment.task_id == task_id).order_by(TaskComment.id))
            ).all()
            results = (
                await s.scalars(select(Artifact.content).where(Artifact.task_id == task_id).order_by(Artifact.version))
            ).all()
            data = StageInput(
                task=TaskSnapshot(id=task.id, title=task.title, description=task.description),
                stage=stage,
                version=version,
                profile=ProfileSnapshot(
                    name=profile.name if profile else "",
                    summary=profile.summary if profile else "",
                    goal=profile.goal if profile else "",
                    constraints=profile.constraints if profile else "",
                    notes=profile.notes if profile else "",
                ),
                agent=agent,
                comments=tuple(CommentSnapshot(c.author, c.body, c.created_at) for c in comments),
                previous_stages={r.stage: r.output for r in done_runs},
                previous_results=tuple(results),
            )
            await s.commit()
            run_id = run.id
        if changed:
            publish_task(task)
        return run_id, data

    async def _execute(self, agent_id: int, task_id: int, data: StageInput) -> StageOutput | BaseException | _Cancelled:
        """Runs the stage; a cancelled task stops it right away (pause waits for the boundary)."""
        work = asyncio.create_task(self._worker.run(data))
        poke = self._poke(agent_id)
        try:
            while True:
                poke.clear()
                waiter = asyncio.create_task(poke.wait())
                done, _ = await asyncio.wait({work, waiter}, timeout=self._t.tick, return_when=asyncio.FIRST_COMPLETED)
                waiter.cancel()
                if work in done:
                    break
                if await self._task_status(task_id) == TaskStatus.CANCELLED:
                    work.cancel()
                    await asyncio.gather(work, return_exceptions=True)
                    return CANCELLED
        finally:
            if not work.done():
                work.cancel()
        if work.cancelled():
            return CANCELLED
        return work.exception() or work.result()

    async def _task_status(self, task_id: int) -> TaskStatus | None:
        async with self._sessions() as s:
            return await s.scalar(select(Task.status).where(Task.id == task_id))

    async def _record(self, task_id: int, run_id: int, outcome: StageOutput | BaseException | _Cancelled) -> None:
        failed_task: Task | None = None
        async with self._sessions() as s:
            run = await s.get_one(Run, run_id, with_for_update=True)
            stage = run.stage
            run.finished_at = now()
            if isinstance(outcome, StageOutput):
                run.status = RunStatus.SUCCEEDED
                run.output = outcome.text
                run.sources = list(outcome.sources)
                run.input_tokens = outcome.input_tokens
                run.output_tokens = outcome.output_tokens
            elif isinstance(outcome, _Cancelled):
                run.status = RunStatus.CANCELLED
            else:
                run.status = RunStatus.FAILED
                run.error = f"{type(outcome).__name__}: {outcome}"
                task = await self._lock_task(s, task_id)
                if task is not None and task.status == TaskStatus.IN_PROGRESS:
                    apply_transition(task, TaskStatus.FAILED, now())
                    failed_task = task
            await s.commit()
        if failed_task is not None:
            log.warning("task %s failed at stage %s: %s", task_id, stage, outcome)
            publish_task(failed_task)

    async def _finish(self, task_id: int, version: int) -> None:
        """The last stage's text becomes the next version of the result; the task goes to review."""
        async with self._sessions() as s:
            task = await self._lock_task(s, task_id)
            if task is None or task.status != TaskStatus.IN_PROGRESS:
                return
            runs = (
                await s.scalars(
                    select(Run)
                    .where(Run.task_id == task_id, Run.attempt == version, Run.status == RunStatus.SUCCEEDED)
                    .order_by(Run.id)
                )
            ).all()
            sources = list(dict.fromkeys(src for r in runs for src in r.sources))
            s.add(Artifact(task_id=task_id, version=version, content=runs[-1].output if runs else "", sources=sources))
            apply_transition(task, TaskStatus.NEEDS_REVIEW, now())
            await s.commit()
        publish_artifact(task_id, task.agent_id, version)
        publish_task(task)
