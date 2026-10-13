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
        "idle_timeout": 5.0,
        "unavailable_wait": 0.01,
        "unavailable_wait_max": 0.02,
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
    or a callable building the response. `gate` holds every stream after its first chunk until set.
    `/api/version` answers unless `down` probes are still to fail (Ollama coming back after a restart)."""

    replies: list[Any]
    requests: list[dict[str, Any]] = field(default_factory=list)
    closed: int = 0
    delay: float = 0.0
    gate: asyncio.Event | None = None
    down: int = 0
    probes: int = 0

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    async def _handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/version":
            self.probes += 1
            if self.probes <= self.down:
                raise httpx.ConnectError("connection refused", request=request)
            return httpx.Response(200, json={"version": "test"})
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
    steps: list[list[dict[str, Any]]] = field(default_factory=list)
    on_partial: Callable[[str], None] | None = None

    async def waiting(self) -> None:
        self.events.append("waiting")

    async def started(self) -> None:
        self.events.append("started")

    async def unavailable(self, url: str) -> None:
        self.events.append("unavailable")

    def partial(self, text: str) -> None:
        self.partials.append(text)
        if self.on_partial:
            self.on_partial(text)

    async def activity(self, steps: list[dict[str, Any]]) -> None:
        self.steps.append(steps)


def tool_turn(name: str, args: dict[str, Any], *, prompt_tokens: int = 50, output_tokens: int = 10) -> list[dict[str, Any]]:
    """A streamed model reply that only asks for one tool call."""
    call = {"function": {"name": name, "arguments": args}}
    return [
        {"message": {"role": "assistant", "content": "", "tool_calls": [call]}, "done": False},
        {"message": {"role": "assistant", "content": ""}, "done": True, "prompt_eval_count": prompt_tokens, "eval_count": output_tokens, "eval_duration": 500_000_000},
    ]
