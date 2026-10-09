from dataclasses import replace
from typing import Any

import pytest

from app.executor.llm import LlmWorker
from app.executor.prompt import CHARS_PER_TOKEN, build_messages, estimate_tokens, reserve_tokens
from app.executor.worker import ProfileSnapshot, StageError
from app.models.enums import TaskStage
from tests.llm_fixtures import FakeOllama, RecordingReport, chunks, llm_settings, stage_input

NUM_CTX, MINIMUM, THINK = 16384, 6144, 6144


def text(chars: int, tag: str) -> str:
    """English-like filler of an exact length, marked at both ends so a cut is visible."""
    body = ("The quick brown fox jumps over the lazy dog while the team ships the release. " * (chars // 70 + 1))
    return f"{tag}-START {body[: max(0, chars - 2 * len(tag) - 14)]} {tag}-END"


def long_rework(draft_chars: int = 10034) -> Any:
    """The task that failed for real (#44): a revision's self-check with a 3k-character description, a 1.4k comment,
    9.9k of research notes, a 10k draft and a 9.8k previous version (about 1700 words each), a 3.2k profile."""
    data = stage_input(
        TaskStage.SELF_CHECK,
        version=2,
        description=text(3029, "DESC"),
        comments=(text(1388, "COMMENT"),),
        previous={TaskStage.RESEARCH: text(9867, "NOTES"), TaskStage.DRAFT: text(draft_chars, "DRAFT")},
        results=(text(9757, "OLD"),),
        system_prompt=text(892, "ROLE"),
    )
    return replace(data, profile=ProfileSnapshot("Alex", text(3198, "PROFILE"), "goal", "constraints", ""))


def section(user: str, title: str) -> str:
    return user.split(f"# {title}")[1].split("\n# ")[0]


def test_the_reserve_keeps_room_for_thinking_and_the_whole_corrected_draft() -> None:
    data = long_rework()
    draft = data.previous_stages[TaskStage.DRAFT]

    reserve = reserve_tokens(data, num_ctx=NUM_CTX, minimum=MINIMUM, think_tokens=THINK)

    assert reserve >= THINK + estimate_tokens(draft)
    assert reserve_tokens(data, num_ctx=NUM_CTX, minimum=MINIMUM, think_tokens=0) < reserve
    plan = stage_input(TaskStage.PLAN)
    assert reserve_tokens(plan, num_ctx=NUM_CTX, minimum=MINIMUM, think_tokens=THINK) == THINK + 1024


def test_a_long_revision_is_shortened_predictably_and_leaves_room_for_the_answer() -> None:
    data = long_rework()
    reserve = reserve_tokens(data, num_ctx=NUM_CTX, minimum=MINIMUM, think_tokens=THINK)

    system, user = (m["content"] for m in build_messages(data, num_ctx=NUM_CTX, reserve_tokens=reserve))

    assert (len(system) + len(user)) / CHARS_PER_TOKEN + reserve <= NUM_CTX
    for kept in ("DRAFT", "COMMENT", "DESC", "PROFILE", "ROLE"):
        assert f"{kept}-START" in system + user and f"{kept}-END" in system + user, kept
    for cut in ("Earlier stage: research", "Previous result (version 1)"):
        assert "[... truncated" in section(user, cut) or "[... omitted" in section(user, cut), cut


def test_an_even_longer_draft_is_the_last_thing_shortened() -> None:
    data = long_rework(draft_chars=14000)
    reserve = reserve_tokens(data, num_ctx=NUM_CTX, minimum=MINIMUM, think_tokens=THINK)

    system, user = (m["content"] for m in build_messages(data, num_ctx=NUM_CTX, reserve_tokens=reserve))

    assert (len(system) + len(user)) / CHARS_PER_TOKEN + reserve <= NUM_CTX
    draft = section(user, "Earlier stage: draft")
    assert "DRAFT-START" in draft and "DRAFT-END" in draft
    assert "truncated" in section(system, "Director profile") or "omitted" in section(system, "Director profile")
    assert "COMMENT-START" in user and "COMMENT-END" in user


def thinking_only(prompt_tokens: int, output_tokens: int, done_reason: str = "length") -> list[dict[str, Any]]:
    return [
        {"message": {"role": "assistant", "content": "", "thinking": "Let me check the draft carefully..."}, "done": False},
        {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": done_reason, "prompt_eval_count": prompt_tokens, "eval_count": output_tokens},
    ]


async def test_when_thinking_fills_the_window_the_call_is_made_again_without_thinking() -> None:
    ollama = FakeOllama([thinking_only(9573, 6810), chunks("# Corrected article")])
    report = RecordingReport()

    out = await LlmWorker(llm_settings(), ollama.transport()).run(long_rework(), report)

    assert out.text == "# Corrected article"
    first, second = ollama.requests
    assert (first["think"], second["think"]) == (True, False)
    assert first["messages"] == second["messages"]
    assert report.events == ["started"]


async def test_an_answer_that_cannot_fit_even_without_thinking_fails_with_the_numbers() -> None:
    ollama = FakeOllama([thinking_only(9573, 6810), thinking_only(9573, 6810)])

    with pytest.raises(StageError) as err:
        await LlmWorker(llm_settings(), ollama.transport()).run(long_rework(), RecordingReport())

    assert len(ollama.requests) == 2
    message = str(err.value)
    assert "did not fit into the model's context window (16384 tokens)" in message
    assert "9573 tokens of input" in message and "6810" in message and "OLLAMA_NUM_CTX" in message
    assert err.value.code == "context_full_thinking"
    assert err.value.params == {"num_ctx": 16384, "input": 9573, "output": 6810}


async def test_a_full_window_is_also_recognised_by_the_token_counts() -> None:
    ollama = FakeOllama([thinking_only(9573, 6807, done_reason="stop"), chunks("ok")])

    out = await LlmWorker(llm_settings(), ollama.transport()).run(long_rework(), RecordingReport())

    assert out.text == "ok" and ollama.requests[1]["think"] is False


async def test_an_empty_answer_with_room_left_says_what_happened() -> None:
    ollama = FakeOllama([thinking_only(1200, 40, done_reason="stop")])

    with pytest.raises(StageError) as err:
        await LlmWorker(llm_settings(), ollama.transport()).run(stage_input(TaskStage.PLAN), RecordingReport())

    assert len(ollama.requests) == 2
    assert "The model finished without writing any text (1200 tokens of input, 40 of output, thinking only) (attempts: 2)" == str(err.value)
    assert (err.value.code, err.value.params) == ("no_text_thinking", {"input": 1200, "output": 40, "attempts": 2})
