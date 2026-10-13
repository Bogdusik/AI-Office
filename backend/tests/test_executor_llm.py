import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.executor import Executor, FakeWorker, LlmWorker, Timings
from app.models import Agent, Run, Task
from app.models.enums import AgentStatus, RunProvider, RunStatus, TaskStage, TaskStatus
from tests.conftest import Factory
from tests.llm_fixtures import FakeOllama, chunks, llm_settings
from tests.test_executor import World, until

LIVE = Timings(arrive=0, depart=0, tick=0.05, progress=0.05)
P, D, C = TaskStage.PLAN, TaskStage.DRAFT, TaskStage.SELF_CHECK


@pytest.fixture
def world(session_factory: async_sessionmaker[AsyncSession]) -> World:
    return World(session_factory)


@pytest.fixture
async def run_with(
    session_factory: async_sessionmaker[AsyncSession], engine: AsyncEngine
) -> AsyncIterator[Callable[[Any], Awaitable[Executor]]]:
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


@pytest.fixture
async def floor(make_floor: Factory) -> dict[str, Any]:
    return await make_floor()


async def test_llm_runs_record_provider_model_tokens_and_result(
    world: World, run_with: Callable[[Any], Awaitable[Executor]], floor: dict[str, Any], make_agent: Factory, make_task: Factory
) -> None:
    agent = await make_agent(floor["id"], model="custom:7b")
    task = await make_task(agent["id"])
    replies = [chunks("plan text"), chunks("draft text"), chunks("# Final\nletter", prompt_tokens=500, output_tokens=90)]
    ollama = FakeOllama(replies)
    await run_with(LlmWorker(llm_settings(), ollama.transport()))

    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    runs = await world.runs(task["id"])
    assert [(r.stage, r.provider, r.model, r.status) for r in runs] == [
        (s, RunProvider.OLLAMA, "custom:7b", RunStatus.SUCCEEDED) for s in (P, D, C)
    ]
    assert [(r.input_tokens, r.output_tokens) for r in runs] == [(120, 45), (120, 45), (500, 90)]
    assert [r.output for r in runs] == ["plan text", "draft text", "# Final\nletter"]
    [artifact] = await world.artifacts(task["id"])
    assert artifact.content == "# Final\nletter"
    assert [b["model"] for b in ollama.requests] == ["custom:7b"] * 3


async def test_partial_text_is_saved_while_generating(
    world: World, run_with: Callable[[Any], Awaitable[Executor]], floor: dict[str, Any], make_agent: Factory, make_task: Factory
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    gate = asyncio.Event()
    ollama = FakeOllama([chunks("Partial plan goes here", pieces=2), chunks("d"), chunks("c")], gate=gate)

    async def held_after_first_content(request: httpx.Request) -> httpx.Response:
        async def body() -> AsyncIterator[bytes]:
            yield b'{"message": {"content": "Partial plan"}, "done": false}\n'
            await gate.wait()
            yield b'{"message": {"content": " goes here"}, "done": false}\n'
            yield b'{"message": {"content": ""}, "done": true, "prompt_eval_count": 10, "eval_count": 5}\n'

        return httpx.Response(200, content=body())

    ollama.replies[0] = held_after_first_content
    await run_with(LlmWorker(llm_settings(), ollama.transport()))

    async def partial_saved() -> bool:
        runs = await world.runs(task["id"])
        return bool(runs) and runs[0].status == RunStatus.RUNNING and runs[0].output == "Partial plan"

    await until(partial_saved)
    gate.set()
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    assert (await world.runs(task["id"]))[0].output == "Partial plan goes here"


async def test_second_agent_waits_for_the_model(
    client: AsyncClient,
    world: World,
    run_with: Callable[[Any], Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    a = await make_agent(floor["id"])
    b = await make_agent(floor["id"])
    ta = await make_task(a["id"])
    tb = await make_task(b["id"])
    gate = asyncio.Event()
    ollama = FakeOllama([chunks("answer")], gate=gate)
    await run_with(LlmWorker(llm_settings(concurrency=1), ollama.transport()))

    async def one_waiting() -> bool:
        statuses = {r.status for t in (ta, tb) for r in await world.runs(t["id"])}
        return statuses == {RunStatus.RUNNING, RunStatus.WAITING}

    await until(one_waiting)
    state = (await client.get("/api/v1/state")).json()["floors"][0]["agents"]
    waiting = {s["id"]: s["current_task"]["waiting_for_model"] for s in state}
    assert sorted(waiting.values()) == [False, True]
    assert all(s["status"] == "working" for s in state)

    gate.set()
    await until(world.is_task(ta["id"], TaskStatus.NEEDS_REVIEW))
    await until(world.is_task(tb["id"], TaskStatus.NEEDS_REVIEW))


async def test_cancel_stops_generation(
    client: AsyncClient,
    world: World,
    run_with: Callable[[Any], Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    ollama = FakeOllama([chunks("endless " * 10)], gate=asyncio.Event())
    await run_with(LlmWorker(llm_settings(), ollama.transport()))
    await until(lambda: len(ollama.requests) == 1)

    loop = asyncio.get_running_loop()
    t0 = loop.time()
    await client.post(f"/api/v1/tasks/{task['id']}/cancel")
    await until(lambda: ollama.closed == 1)
    assert loop.time() - t0 < 1
    await until(world.is_agent(agent["id"], AgentStatus.IDLE))
    [run] = await world.runs(task["id"])
    assert run.status == RunStatus.CANCELLED


async def test_waiting_runs_are_interrupted_on_restart(
    db: AsyncSession, world: World, run_with: Callable[[Any], Awaitable[Executor]], floor: dict[str, Any], make_agent: Factory, make_task: Factory
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    db_agent, db_task = await db.get_one(Agent, agent["id"]), await db.get_one(Task, task["id"])
    db_agent.status = AgentStatus.WORKING
    db_task.status, db_task.stage, db_task.started_at = TaskStatus.IN_PROGRESS, P, datetime.now(UTC)
    db.add(Run(task_id=task["id"], stage=P, provider=RunProvider.OLLAMA, status=RunStatus.WAITING))
    await db.commit()

    await run_with(FakeWorker(0))
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))
    assert [r.status for r in await world.runs(task["id"])][0] == RunStatus.INTERRUPTED


async def test_research_sources_and_steps_are_saved(
    client: AsyncClient,
    world: World,
    run_with: Callable[[Any], Awaitable[Executor]],
    floor: dict[str, Any],
    make_agent: Factory,
    make_task: Factory,
) -> None:
    from tests.llm_fixtures import tool_turn
    from tests.test_research import GUIDE, PUBLIC
    from app.executor.research import WebTools
    from app.web import FetchLimits, PageFetcher, SearxClient

    gate = asyncio.Event()

    async def site(request: httpx.Request) -> httpx.Response:
        await gate.wait()
        return httpx.Response(200, headers={"content-type": "text/html"}, text=GUIDE)

    async def resolve(host: str, port: int) -> list[str]:
        return [PUBLIC]

    def searx(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [{"title": "Guide", "url": "https://docs.example/guide"}]})

    tools = WebTools(
        search=SearxClient("http://searx.test", transport=httpx.MockTransport(searx)),
        fetcher=PageFetcher(FetchLimits(), resolve, httpx.MockTransport(site)),
    )
    agent = await make_agent(floor["id"], web_access=True)
    task = await make_task(agent["id"])
    replies = [
        chunks("plan"),
        tool_turn("web_search", {"query": "fastapi"}),
        tool_turn("fetch_page", {"url": "https://docs.example/guide"}),
        chunks("- FastAPI uses SQLAlchemy [1]"),
        chunks("draft [1]"),
        chunks("final [1]\n\n## Sources\n[1] https://docs.example/guide"),
    ]
    await run_with(LlmWorker(llm_settings(), FakeOllama(replies).transport(), web=tools))

    async def reading() -> bool:
        state = (await client.get("/api/v1/state")).json()["floors"][0]["agents"][0]
        return bool(state["current_task"] and state["current_task"]["on_web"])

    await until(reading)
    gate.set()
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW))

    runs = await world.runs(task["id"])
    research = next(r for r in runs if r.stage == TaskStage.RESEARCH)
    assert research.sources == ["https://docs.example/guide"]
    assert [(s["kind"], s["status"]) for s in research.activity] == [("search", "done"), ("fetch", "done")]
    assert research.output.endswith("## Sources\n[1] FastAPI and PostgreSQL — <https://docs.example/guide>")
    assert research.tokens_per_second == 20.0
    [artifact] = await world.artifacts(task["id"])
    assert artifact.sources == ["https://docs.example/guide"]
    detail = (await client.get(f"/api/v1/tasks/{task['id']}")).json()
    assert detail["artifacts"][0]["sources"] == ["https://docs.example/guide"]
    assert next(r for r in detail["runs"] if r["stage"] == "research")["activity"][1]["source"] == 1

