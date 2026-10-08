from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient

from app.executor import Executor, FakeWorker, StageInput, StageOutput
from app.executor.worker import StageReport
from app.models import Agent, Run
from app.models.agent import ACTIVITY_LOG_SIZE
from app.models.enums import ActivityKind, AgentStatus, RunProvider, RunStatus, TaskStage, TaskStatus
from app.services.state import web_step
from tests.conftest import Factory
from tests.test_executor import World, start_executor, until, world  # noqa: F401 (fixtures)


class QueuedWorker(FakeWorker):
    """Every stage first waits for the model, then runs."""

    def __init__(self) -> None:
        super().__init__(0)

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        await report.waiting()
        await report.started()
        return await super().run(data, report)


def kinds(agent: dict[str, Any]) -> list[str]:
    return [a["kind"] for a in agent["activity_log"]]


def _agent(state: dict[str, Any], agent_id: int) -> dict[str, Any]:
    return next(a for f in state["floors"] for a in f["agents"] if a["id"] == agent_id)


async def test_activity_log_follows_the_lifecycle_and_the_model_queue(
    client: AsyncClient,
    world: World,
    start_executor: Callable[..., Awaitable[Executor]],
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    await start_executor(QueuedWorker())
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_agent(agent["id"], AgentStatus.WAITING_REVIEW))

    log = kinds(_agent((await client.get("/api/v1/state")).json(), agent["id"]))
    assert log[:3] == ["arriving", "idle", "working"]
    assert log[-1] == "waiting_review"
    assert log.count("waiting_model") >= 1
    assert all(a != b for a, b in zip(log, log[1:])), "no repeated entries"
    sinces = [a["since"] for a in _agent((await client.get("/api/v1/state")).json(), agent["id"])["activity_log"]]
    assert sinces == sorted(sinces)


def test_activity_log_keeps_the_latest_entries() -> None:
    agent = Agent(name="A", role_key="a", title="A", activity_log=[])
    start = datetime(2026, 10, 8, tzinfo=UTC)
    for i in range(30):
        agent.set_activity(ActivityKind.WORKING if i % 2 else ActivityKind.WAITING_MODEL, start + timedelta(seconds=i))
    agent.set_activity(ActivityKind.WORKING, start + timedelta(seconds=99))
    assert len(agent.activity_log) == ACTIVITY_LOG_SIZE == 12
    assert agent.activity_log[-1]["since"] == (start + timedelta(seconds=29)).isoformat()
    agent.set_status(AgentStatus.LEAVING, start + timedelta(seconds=100))
    assert agent.activity_log[-1] == {"kind": "leaving", "since": (start + timedelta(seconds=100)).isoformat()}


def test_web_step_shows_the_query_or_the_site() -> None:
    def run(*steps: dict[str, object], status: RunStatus = RunStatus.RUNNING) -> Run:
        return Run(stage=TaskStage.RESEARCH, provider=RunProvider.OLLAMA, status=status, activity=list(steps))

    fetch = {"kind": "fetch", "target": "https://docs.python.org/3/library/asyncio.html", "url": "https://docs.python.org/3/library/asyncio.html", "status": "running"}
    search = {"kind": "search", "target": "python asyncio tutorial", "status": "running"}
    assert web_step(run(search)).model_dump() == {"kind": "search", "target": "python asyncio tutorial"}
    assert web_step(run(search, fetch)).model_dump() == {"kind": "fetch", "target": "docs.python.org"}
    assert web_step(run({**fetch, "status": "done"})) is None
    assert web_step(run(fetch, status=RunStatus.WAITING)) is None
    assert web_step(None) is None
