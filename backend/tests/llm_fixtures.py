import asyncio
import inspect
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.executor.llm import LlmSettings
from app.executor.worker import AgentSnapshot, CommentSnapshot, ProfileSnapshot, StageInput, TaskSnapshot
from app.models.enums import CommentAuthor, TaskStage


def stage_input(
    stage: TaskStage = TaskStage.PLAN,
    *,
    version: int = 1,
    comments: tuple[str, ...] = (),
    previous: dict[TaskStage, str] | None = None,
    results: tuple[str, ...] = (),
    description: str = "Write a cover letter for the Junior Backend Engineer role.",
    model: str | None = None,
    system_prompt: str = "You are a job search specialist.",
    notes: str = "",
) -> StageInput:
    return StageInput(
        task=TaskSnapshot(id=1, title="Cover letter", description=description),
        stage=stage,
        version=version,
        profile=ProfileSnapshot(
            name="Alex", summary="BSc Computing graduate", goal="First backend role", constraints="UK only", notes=notes
        ),
        agent=AgentSnapshot(
            id=1, name="Jordan", title="Job Search Specialist", system_prompt=system_prompt, model=model, web_access=True
        ),
        comments=tuple(CommentSnapshot(CommentAuthor.DIRECTOR, c, datetime.now(UTC)) for c in comments),
        previous_stages=previous or {},
        previous_results=results,
    )


def llm_settings(**overrides: Any) -> LlmSettings:
    values: dict[str, Any] = {
        "url": "http://ollama.test",
        "model": "qwen3.8:27b",
        "num_ctx": 16384,
        "think": True,
        "temperature": 0.3,
        "concurrency": 1,
        "stage_timeout": 5.0,
        "retries": 1,
        "reserve_tokens": 6144,
    }
    return LlmSettings(**{**values, **overrides})


def chunks(text: str, *, prompt_tokens: int = 120, output_tokens: int = 45, pieces: int = 3) -> list[dict[str, Any]]:
    step = max(1, len(text) // pieces)
    parts = [text[i : i + step] for i in range(0, len(text), step)]
    body: list[dict[str, Any]] = [{"message": {"role": "assistant", "thinking": "hmm"}, "done": False}]
    body += [{"message": {"role": "assistant", "content": p}, "done": False} for p in parts]
    body.append({"message": {"role": "assistant", "content": ""}, "done": True, "prompt_eval_count": prompt_tokens, "eval_count": output_tokens})
    return body


@dataclass
class FakeOllama:
    """A scripted /api/chat. Each request takes the next reply; a reply is a status code, a chunk list,
    or a callable building the response. `gate` holds every stream after its first chunk until set."""

    replies: list[Any]
    requests: list[dict[str, Any]] = field(default_factory=list)
    closed: int = 0
    delay: float = 0.0
    gate: asyncio.Event | None = None

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    async def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        reply = self.replies[min(len(self.requests), len(self.replies)) - 1]
        if isinstance(reply, int):
            return httpx.Response(reply, json={"error": f"status {reply}"})
        if isinstance(reply, Exception):
            raise reply
        if callable(reply):
            result = reply(request)
            return await result if inspect.isawaitable(result) else result
        return httpx.Response(200, content=self._stream(reply))

    async def _stream(self, body: list[dict[str, Any]]) -> AsyncIterator[bytes]:
        try:
            for i, chunk in enumerate(body):
                if self.delay:
                    await asyncio.sleep(self.delay)
                if i == 1 and self.gate is not None:
                    await self.gate.wait()
                yield (json.dumps(chunk) + "\n").encode()
        finally:
            self.closed += 1


@dataclass
class RecordingReport:
    events: list[str] = field(default_factory=list)
    partials: list[str] = field(default_factory=list)
    on_partial: Callable[[str], None] | None = None

    async def waiting(self) -> None:
        self.events.append("waiting")

    async def started(self) -> None:
        self.events.append("started")

    def partial(self, text: str) -> None:
        self.partials.append(text)
        if self.on_partial:
            self.on_partial(text)
