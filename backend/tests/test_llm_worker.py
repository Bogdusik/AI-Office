import asyncio
from typing import Any

import httpx
import pytest

from app.executor.llm import LlmWorker, ModelMissing, StageTimeout, strip_service_lines
from app.executor.worker import StageError
from app.models.enums import RunProvider, TaskStage
from tests.llm_fixtures import FakeOllama, RecordingReport, chunks, llm_settings, stage_input


async def test_request_shape_and_result() -> None:
    ollama = FakeOllama([chunks("# Letter\nDear team,", prompt_tokens=321, output_tokens=87)])
    worker = LlmWorker(llm_settings(num_ctx=8192, think=False, temperature=0.2), ollama.transport())
    report = RecordingReport()

    out = await worker.run(stage_input(TaskStage.DRAFT), report)

    [body] = ollama.requests
    assert body["model"] == "qwen3.8:27b"
    assert body["stream"] is True and body["think"] is False
    assert body["options"] == {"num_ctx": 8192, "temperature": 0.2}
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "Stage: draft." in body["messages"][1]["content"]
    assert (out.text, out.input_tokens, out.output_tokens) == ("# Letter\nDear team,", 321, 87)
    assert report.events == ["started"]
    assert report.partials[-1] == "# Letter\nDear team,"
    assert len(report.partials) >= 2 and report.partials[0] != report.partials[-1]
    assert worker.provider == RunProvider.OLLAMA


async def test_agent_model_overrides_the_default() -> None:
    ollama = FakeOllama([chunks("ok")])
    worker = LlmWorker(llm_settings(), ollama.transport())
    data = stage_input(model="  other:14b ")
    assert worker.model_for(data.agent) == "other:14b"
    await worker.run(data, RecordingReport())
    assert ollama.requests[0]["model"] == "other:14b"


async def test_queue_reports_waiting_and_timeout_starts_at_sending() -> None:
    ollama = FakeOllama([chunks("first answer", pieces=5), chunks("second answer", pieces=5)], delay=0.03)
    worker = LlmWorker(llm_settings(idle_timeout=0.4, retries=0), ollama.transport())
    first, second = RecordingReport(), RecordingReport()

    loop = asyncio.get_running_loop()
    t0 = loop.time()
    a = asyncio.create_task(worker.run(stage_input(), first))
    await asyncio.sleep(0.01)
    b = asyncio.create_task(worker.run(stage_input(), second))
    results = await asyncio.gather(a, b)
    assert loop.time() - t0 > 0.4, "second request waited longer than the timeout in total"

    assert [r.text for r in results] == ["first answer", "second answer"]
    assert first.events == ["started"]
    assert second.events == ["waiting", "started"]
    assert len(ollama.requests) == 2


async def test_concurrency_setting_allows_parallel_requests() -> None:
    ollama = FakeOllama([chunks("x"), chunks("y")], delay=0.02)
    worker = LlmWorker(llm_settings(concurrency=2), ollama.transport())
    reports = [RecordingReport(), RecordingReport()]
    await asyncio.gather(*(worker.run(stage_input(), r) for r in reports))
    assert all(r.events == ["started"] for r in reports)


async def test_timeout_retries_once_then_fails() -> None:
    ollama = FakeOllama([chunks("too slow")], delay=0.5)
    worker = LlmWorker(llm_settings(idle_timeout=0.1, retries=1), ollama.transport())
    with pytest.raises(StageTimeout, match=r"wrote nothing for 0\.1 s \(attempts: 2\)"):
        await worker.run(stage_input(), RecordingReport())
    assert len(ollama.requests) == 2
    assert ollama.closed == 2


async def test_server_error_is_retried_and_can_recover() -> None:
    ollama = FakeOllama([500, chunks("recovered")])
    out = await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(), RecordingReport())
    assert out.text == "recovered"
    assert len(ollama.requests) == 2


async def test_server_error_twice_fails_with_details() -> None:
    ollama = FakeOllama([500, 503])
    with pytest.raises(StageError, match=r"Ollama returned an error 503.*\(attempts: 2\)") as err:
        await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(), RecordingReport())
    assert err.value.code == "ollama_error" and err.value.params["status"] == 503 and err.value.params["attempts"] == 2


async def test_missing_model_is_not_retried() -> None:
    ollama = FakeOllama([404])
    with pytest.raises(ModelMissing, match=r"Model “qwen3\.8:27b” is not downloaded in Ollama\. Run: ollama pull qwen3\.8:27b"):
        await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(), RecordingReport())
    assert len(ollama.requests) == 1


async def test_ollama_down_is_waited_for_with_a_reason() -> None:
    def refuse(request: httpx.Request) -> Any:
        raise httpx.ConnectError("connection refused", request=request)

    ollama = FakeOllama([refuse, chunks("back again")], down=3)
    report = RecordingReport()
    out = await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(), report)
    assert out.text == "back again"
    assert report.events == ["started", "unavailable", "started"]
    assert ollama.probes == 4 and len(ollama.requests) == 2


async def test_empty_answer_is_an_error() -> None:
    ollama = FakeOllama([[{"message": {"content": ""}, "done": True, "eval_count": 3}]])
    with pytest.raises(StageError, match=r"finished without writing any text \(0 tokens of input, 3 of output\)"):
        await LlmWorker(llm_settings(retries=0), ollama.transport()).run(stage_input(), RecordingReport())


async def test_cancel_closes_the_stream_and_frees_the_gpu() -> None:
    gate = asyncio.Event()
    ollama = FakeOllama([chunks("never finishes " * 5), chunks("next")], gate=gate)
    worker = LlmWorker(llm_settings(), ollama.transport())
    started = asyncio.Event()
    running = asyncio.create_task(worker.run(stage_input(), RecordingReport(on_partial=lambda _: started.set())))
    await asyncio.wait_for(asyncio.shield(_until(lambda: len(ollama.requests) == 1)), 2)

    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert ollama.closed == 1

    gate.set()
    out = await asyncio.wait_for(worker.run(stage_input(), RecordingReport()), 2)
    assert out.text == "next"


async def _until(check: Any) -> None:
    while not check():
        await asyncio.sleep(0.01)


SERVICE_SAMPLES = [
    "# DRAFT – for Alex's review",
    "**DRAFT for director review. Nothing here has been sent, filed, or submitted.**",
    "> Draft for the director's review",
    "*Status: draft*",
    "Nothing in this document has been sent or submitted.",
]


@pytest.mark.parametrize("line", SERVICE_SAMPLES)
def test_service_lines_are_dropped(line: str) -> None:
    text = f"{line}\n\n# Cover letter\n\nDear team,\n\n---\n\n{line}\n"
    assert strip_service_lines(text) == "# Cover letter\n\nDear team,"


def test_content_mentioning_drafts_stays() -> None:
    text = "# Draft email to the recruiter — review before sending\n\nI sent my CV last week.\n\n---\n\n## Sources\n1. x"
    assert strip_service_lines(text) == text


async def test_deliverable_stages_drop_service_lines_but_research_keeps_its_notes() -> None:
    ollama = FakeOllama([chunks("**DRAFT for director review.**\n\nBody"), chunks("**DRAFT for director review.**\n\nBody")])
    worker = LlmWorker(llm_settings(), ollama.transport())
    final = await worker.run(stage_input(TaskStage.SELF_CHECK), RecordingReport())
    notes = await worker.run(stage_input(TaskStage.RESEARCH), RecordingReport())
    assert final.text == "Body"
    assert notes.text.startswith("**DRAFT")
