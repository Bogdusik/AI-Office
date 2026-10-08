import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.executor import Executor, LlmWorker
from app.executor.job_tools import NOT_ELIGIBLE_HEADING
from app.jobs.sources import STATES, record
from app.models import Run
from app.models.enums import RunStatus, TaskStage, TaskStatus
from app.services.server_room import build_server_room
from app.services.state import web_step
from tests.conftest import Factory
from tests.llm_fixtures import FakeOllama, chunks, llm_settings, tool_turn
from tests.test_executor import World, until
from tests.test_executor_llm import LIVE
from tests.test_job_tools import SEARCH_RESULTS, job_tools
from tests.test_server_room import StubProbes


@pytest.fixture
async def run_with(session_factory: async_sessionmaker[AsyncSession], engine: AsyncEngine) -> AsyncIterator[Callable[[Any], Awaitable[Executor]]]:
    running: list[Executor] = []

    async def _start(worker: Any) -> Executor:
        executor = Executor(session_factory, engine, worker, LIVE)
        await executor.start()
        running.append(executor)
        await until(lambda: executor.active)
        return executor

    yield _start
    for executor in running:
        await executor.stop()


async def test_tools_are_an_agent_setting(client: AsyncClient, make_floor: Factory, make_agent: Factory) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"], tools=["jobs", "jobs"])
    assert agent["tools"] == ["jobs"]

    plain = await make_agent(floor["id"])
    assert plain["tools"] == []
    res = await client.patch(f"/api/v1/agents/{agent['id']}", json={"tools": []})
    assert res.status_code == 200 and res.json()["tools"] == []
    assert (await client.patch(f"/api/v1/agents/{agent['id']}", json={"tools": ["email"]})).status_code == 422

    state = (await client.get("/api/v1/state")).json()
    assert [a["tools"] for a in state["floors"][0]["agents"]] == [[], []]


async def test_a_search_task_keeps_its_vacancies_and_the_filter_on_the_result(
    run_with: Callable[[Any], Awaitable[Executor]], session_factory: async_sessionmaker[AsyncSession], client: AsyncClient,
    make_floor: Factory, make_agent: Factory, make_task: Factory,
) -> None:
    world = World(session_factory)
    floor = await make_floor()
    agent = await make_agent(floor["id"], tools=["jobs"])
    task = await make_task(agent["id"], title="Junior Python roles in Leeds")
    tools, _, _ = job_tools(SEARCH_RESULTS)
    excluded_url = SEARCH_RESULTS["results"][1]["redirect_url"]
    final = f"# Shortlist\n- Junior Python Developer — Kestrel Payments\n- Python Engineer — Aegis Defence — {excluded_url}"
    ollama = FakeOllama(
        [
            chunks("plan"),
            tool_turn("search_jobs", {"query": "python", "location": "Leeds"}),
            chunks("- [J1] fits"),
            chunks("draft"),
            chunks(final),
        ]
    )
    await run_with(LlmWorker(llm_settings(), ollama.transport(), jobs=tools))

    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    runs = await world.runs(task["id"])
    assert [r.stage for r in runs] == [TaskStage.PLAN, TaskStage.RESEARCH, TaskStage.DRAFT, TaskStage.SELF_CHECK]
    research = runs[1]
    assert research.jobs is not None and research.jobs["calls"] == 1
    assert [s["kind"] for s in research.activity] == ["jobs"]
    assert "You have 10 job tool calls" in ollama.requests[1]["messages"][1]["content"]
    assert "Vacancies: use only the jobs listed under 'Jobs found'" in ollama.requests[3]["messages"][1]["content"]
    [artifact] = await world.artifacts(task["id"])
    assert artifact.jobs == research.jobs
    body, tail = artifact.content.split(NOT_ELIGIBLE_HEADING)
    assert "Aegis" not in body and "Kestrel" in body
    assert "Aegis Defence" in tail and artifact.content.endswith("Excluded by the eligibility filter: 1 (1 security clearance with a UK residency condition (SC/DV/NPPV))")

    detail = (await client.get(f"/api/v1/tasks/{task['id']}")).json()
    assert detail["artifacts"][0]["jobs"]["excluded"][0]["company"] == "Aegis Defence"
    assert next(r for r in detail["runs"] if r["stage"] == "research")["jobs"]["jobs"][0]["ref"] == "J1"


async def test_server_room_shows_job_sources_without_their_keys(db: AsyncSession) -> None:
    STATES.clear()
    settings = Settings(
        database_url="postgresql+asyncpg://x/y",
        adzuna_app_id=SecretStr("id-xyz"),
        adzuna_app_key=SecretStr("key-xyz"),
        reed_api_key=SecretStr(""),
    )
    record("adzuna", None)
    record("reed", "Reed rejected the API key (HTTP 401)")

    room = await build_server_room(db, settings, StubProbes())

    rows = {s.name: s for s in room.job_sources}
    assert (rows["adzuna"].configured, rows["adzuna"].last_ok_at is not None, rows["adzuna"].last_error) == (True, True, None)
    assert (rows["reed"].configured, rows["reed"].last_error) == (False, "Reed rejected the API key (HTTP 401)")
    dumped = json.dumps(room.model_dump(mode="json"))
    assert "id-xyz" not in dumped and "key-xyz" not in dumped
    STATES.clear()


def test_the_scene_caption_knows_job_steps() -> None:
    def run(step: dict[str, Any]) -> Run:
        return Run(status=RunStatus.RUNNING, activity=[step])

    assert web_step(run({"kind": "jobs", "target": "python · Leeds", "status": "running"})).model_dump() == {"kind": "jobs", "target": "python · Leeds"}  # type: ignore[union-attr]
    assert web_step(run({"kind": "job", "target": "J3 Python Developer — Kestrel", "status": "running"})).model_dump() == {"kind": "job", "target": "Python Developer — Kestrel"}  # type: ignore[union-attr]
