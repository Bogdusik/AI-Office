"""Ollama going away for a while does not fail work: calls wait for it and go on from what was written (audit P1, P2)."""

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
from httpx import AsyncClient

from app.executor import Executor, LlmWorker
from app.models.enums import RunStatus, TaskStage, TaskStatus
from tests.conftest import Factory
from tests.llm_fixtures import FakeOllama, RecordingReport, chunks, llm_settings, stage_input
from tests.test_executor import World, until
from tests.test_executor_llm import floor, run_with, world  # noqa: F401  (fixtures)


def breaks_after(text: str, pieces: int = 3) -> Callable[[httpx.Request], httpx.Response]:
    """A stream that sends some of the answer and then loses the connection (Ollama restarted)."""

    def reply(request: httpx.Request) -> httpx.Response:
        async def body() -> AsyncIterator[bytes]:
            yield (json.dumps({"message": {"role": "assistant", "thinking": "hmm"}, "done": False}) + "\n").encode()
            step = max(1, len(text) // pieces)
            for i in range(0, len(text), step):
                yield (json.dumps({"message": {"role": "assistant", "content": text[i : i + step]}, "done": False}) + "\n").encode()
            raise httpx.ReadError("connection reset by peer")

        return httpx.Response(200, content=body())

    return reply


def refuse(request: httpx.Request) -> Any:
    raise httpx.ConnectError("connection refused", request=request)


async def test_a_broken_stream_goes_on_from_the_text_already_written() -> None:
    ollama = FakeOllama([breaks_after("Mercury\nVenus\nEarth\n"), chunks("\nMars\nJupiter")], down=2)
    report = RecordingReport()
    out = await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(TaskStage.DRAFT), report)

    assert out.text == "Mercury\nVenus\nEarth\nMars\nJupiter"
    resumed = ollama.requests[1]["messages"]
    assert resumed[-1] == {"role": "assistant", "content": "Mercury\nVenus\nEarth"}
    assert resumed[:-1] == ollama.requests[0]["messages"]
    assert report.events == ["started", "unavailable", "started"]
    assert "" not in report.partials[report.partials.index("Mercury\nVenus\nEarth\n") :], "the live text never went blank"


async def test_a_slow_but_steady_stream_is_not_a_timeout() -> None:
    ollama = FakeOllama([chunks("word " * 12, pieces=12)], delay=0.06)
    out = await LlmWorker(llm_settings(idle_timeout=0.2, retries=0), ollama.transport()).run(stage_input(), RecordingReport())
    assert out.text == ("word " * 12).strip()
    assert len(ollama.requests) == 1


async def test_a_stream_that_stops_is_resumed_once_then_fails() -> None:
    ollama = FakeOllama([chunks("stalls")], delay=0.5)
    try:
        await LlmWorker(llm_settings(idle_timeout=0.1, retries=1), ollama.transport()).run(stage_input(), RecordingReport())
    except Exception as err:  # noqa: BLE001
        assert getattr(err, "code", None) == "model_timeout" and err.params["seconds"] == 0.1  # type: ignore[attr-defined]
    else:
        raise AssertionError("a silent stream must time out")


async def test_the_queue_survives_an_outage(
    world: World,
    run_with: Callable[[Any], Awaitable[Executor]],
    floor: dict[str, Any],  # noqa: F811
    make_agent: Factory,
    make_task: Factory,
) -> None:
    """Ollama is down when the first stage is sent and comes back later: every queued task still reaches review."""
    first, second = await make_agent(floor["id"]), await make_agent(floor["id"])
    tasks = [await make_task(first["id"]), await make_task(first["id"]), await make_task(second["id"])]
    ollama = FakeOllama([refuse, *[chunks(f"text {i}") for i in range(9)]], down=4)
    await run_with(LlmWorker(llm_settings(unavailable_wait=0.05, unavailable_wait_max=0.05), ollama.transport()))

    for task in tasks:
        await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW), timeout=10)
    for task in tasks:
        assert all(r.status == RunStatus.SUCCEEDED for r in await world.runs(task["id"]))


async def test_a_waiting_run_says_why_and_a_pause_stops_it_at_once(
    client: AsyncClient,
    world: World,
    run_with: Callable[[Any], Awaitable[Executor]],
    floor: dict[str, Any],  # noqa: F811
    make_agent: Factory,
    make_task: Factory,
) -> None:
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])
    ollama = FakeOllama([refuse, chunks("plan"), chunks("draft"), chunks("final")], down=10**6)
    await run_with(LlmWorker(llm_settings(unavailable_wait=0.05, unavailable_wait_max=0.05), ollama.transport()))

    async def waiting_for_ollama() -> bool:
        runs = await world.runs(task["id"])
        return bool(runs) and runs[-1].status == RunStatus.WAITING and runs[-1].error_code == "model_unavailable"

    await until(waiting_for_ollama)
    run = (await world.runs(task["id"]))[-1]
    assert run.error_params == {"url": "http://ollama.test"} and await world.task_status(task["id"]) == TaskStatus.IN_PROGRESS

    assert (await client.post(f"/api/v1/tasks/{task['id']}/pause")).status_code == 200
    await until(world.is_task(task["id"], TaskStatus.PAUSED))

    async def interrupted() -> bool:
        return (await world.runs(task["id"]))[-1].status == RunStatus.INTERRUPTED

    await until(interrupted)
    assert (await world.runs(task["id"]))[-1].error_code == "paused_waiting"

    ollama.down = 0
    assert (await client.post(f"/api/v1/tasks/{task['id']}/resume")).status_code == 200
    await until(world.is_task(task["id"], TaskStatus.NEEDS_REVIEW), timeout=10)
    assert [r.status for r in await world.runs(task["id"])][-3:] == [RunStatus.SUCCEEDED] * 3
    await asyncio.sleep(0)
