"""Stage worker backed by a local model in Ollama (`/api/chat`, streamed).

- GPU queue: at most `concurrency` requests in flight; an agent waiting for a slot reports `waiting`.
  The slot is held for one model call only, so tool calls (web) never block other agents.
- A call's timeout starts when the request is sent, not when the agent joins the queue.
- One retry after a timeout, a dropped connection or a 5xx; a missing model is not retried.
- Cancelling the asyncio task closes the HTTP stream, and Ollama stops generating.
- The research stage of an agent with web access runs a tool loop (see `research.py`).
"""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import httpx

from app.executor.prompt import build_messages
from app.executor.worker import AgentSnapshot, StageError, StageInput, StageOutput, StageReport
from app.models.enums import RunProvider, TaskStage


@dataclass(frozen=True)
class LlmSettings:
    url: str
    model: str
    num_ctx: int
    think: bool
    temperature: float
    concurrency: int
    stage_timeout: float
    retries: int
    reserve_tokens: int


class OllamaUnavailable(StageError):
    pass


class ModelMissing(StageError):
    pass


class StageTimeout(StageError):
    pass


class _Retryable(Exception):
    pass


@dataclass
class Turn:
    """One model call: its text, any tool calls, token counts and generation speed."""

    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    tokens_per_second: float | None = None


class LlmWorker:
    provider = RunProvider.OLLAMA

    def __init__(
        self,
        settings: LlmSettings,
        transport: httpx.AsyncBaseTransport | None = None,
        web: "Any | None" = None,
    ) -> None:
        self.settings = settings
        self._transport = transport
        self._gpu = asyncio.Semaphore(settings.concurrency)
        self.web = web
        """`research.WebTools`, or None when web search is off."""

    def model_for(self, agent: AgentSnapshot) -> str:
        return (agent.model or "").strip() or self.settings.model

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        if data.stage == TaskStage.RESEARCH and data.agent.web_access and self.web is not None:
            from app.executor.research import run_research

            return await run_research(self, self.web, data, report)
        s = self.settings
        model = self.model_for(data.agent)
        messages = build_messages(data, num_ctx=s.num_ctx, reserve_tokens=s.reserve_tokens, today=date.today())
        turn = await self.generate(model, messages, report)
        if not turn.content:
            raise StageError("Модель вернула пустой ответ")
        return StageOutput(
            text=turn.content,
            input_tokens=turn.input_tokens,
            output_tokens=turn.output_tokens,
            tokens_per_second=turn.tokens_per_second,
        )

    async def generate(
        self,
        model: str,
        messages: list[dict[str, Any]],
        report: StageReport,
        tools: list[dict[str, Any]] | None = None,
        timeout: float | None = None,
    ) -> Turn:
        """One model call through the GPU queue, with the timeout counted from sending and one retry."""
        s = self.settings
        limit = s.stage_timeout if timeout is None else min(timeout, s.stage_timeout)
        if self._gpu.locked():
            await report.waiting()
        async with self._gpu:
            await report.started()
            attempts = 1 + max(0, s.retries)
            for attempt in range(1, attempts + 1):
                try:
                    async with asyncio.timeout(limit):
                        return await self._chat(model, messages, report, tools)
                except TimeoutError:
                    failure: StageError = StageTimeout(
                        f"Модель «{model}» не ответила за {limit:g} с (попыток: {attempt})."
                    )
                except _Retryable as err:
                    failure = StageError(f"{err} (попыток: {attempt})")
                except httpx.ConnectError:
                    failure = OllamaUnavailable(
                        f"Ollama не отвечает по адресу {s.url}. Запустите Ollama и повторите задачу."
                    )
                if attempt == attempts:
                    raise failure
                report.partial("")
        raise AssertionError("unreachable")

    async def _chat(
        self, model: str, messages: list[dict[str, Any]], report: StageReport, tools: list[dict[str, Any]] | None
    ) -> Turn:
        s = self.settings
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": s.think,
            "options": {"num_ctx": s.num_ctx, "temperature": s.temperature},
        }
        if tools:
            body["tools"] = tools
        turn = Turn()
        content: list[str] = []
        async with httpx.AsyncClient(base_url=s.url, timeout=httpx.Timeout(None, connect=5), transport=self._transport) as client:
            try:
                async with client.stream("POST", "/api/chat", json=body) as response:
                    if response.status_code == 404:
                        raise ModelMissing(f"Модель «{model}» не скачана в Ollama. Выполните: ollama pull {model}")
                    if response.status_code >= 500:
                        detail = (await response.aread()).decode(errors="replace")[:300]
                        raise _Retryable(f"Ollama вернула ошибку {response.status_code}: {detail}")
                    if response.status_code >= 400:
                        detail = (await response.aread()).decode(errors="replace")[:300]
                        raise StageError(f"Ollama отклонила запрос ({response.status_code}): {detail}")
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if "error" in chunk:
                            raise _Retryable(f"Ollama: {chunk['error']}")
                        message = chunk.get("message") or {}
                        if message.get("content"):
                            content.append(message["content"])
                            report.partial("".join(content))
                        if message.get("tool_calls"):
                            turn.tool_calls.extend(message["tool_calls"])
                        if chunk.get("done"):
                            turn.content = "".join(content).strip()
                            turn.input_tokens = int(chunk.get("prompt_eval_count") or 0)
                            turn.output_tokens = int(chunk.get("eval_count") or 0)
                            seconds = (chunk.get("eval_duration") or 0) / 1e9
                            turn.tokens_per_second = round(turn.output_tokens / seconds, 1) if seconds > 0 else None
                            if not turn.content and not turn.tool_calls:
                                raise _Retryable("Модель вернула пустой ответ")
                            return turn
            except (httpx.ReadError, httpx.RemoteProtocolError, httpx.WriteError) as err:
                raise _Retryable(f"Соединение с Ollama оборвалось: {err}") from err
        raise _Retryable("Ollama закрыла поток, не завершив ответ")
