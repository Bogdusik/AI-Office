"""Stage worker backed by a local model in Ollama (`/api/chat`, streamed).

- GPU queue: at most `concurrency` requests in flight; an agent waiting for a slot reports `waiting`.
  The slot is held for one model call only, so tool calls (web) never block other agents.
- A call's timeout starts when the request is sent, not when the agent joins the queue.
- One retry after a timeout, a dropped connection or a 5xx; a missing model is not retried.
- The context window keeps room for thinking and the answer (`prompt.reserve_tokens`). If the window still fills
  up before any text (thinking took it all), the call is made once more without thinking; an answer that cannot
  fit even then fails with the numbers, never as an unexplained empty answer.
- Cancelling the asyncio task closes the HTTP stream, and Ollama stops generating.
- The research stage of an agent with web access runs a tool loop (see `research.py`).
"""

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import httpx

from app.executor.job_tools import finalize
from app.executor.prompt import build_messages, reserve_tokens
from app.executor.worker import AgentSnapshot, StageError, StageInput, StageOutput, StageReport
from app.models.enums import AgentTool, RunProvider, TaskStage


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
    think_tokens: int = 6144


class OllamaUnavailable(StageError):
    pass


class ModelMissing(StageError):
    pass


class StageTimeout(StageError):
    pass


class _Retryable(Exception):
    pass


class _ContextFull(Exception):
    """The context window filled up before the model wrote any text."""

    def __init__(self, prompt_tokens: int, output_tokens: int, thought: bool) -> None:
        super().__init__("context window full")
        self.prompt_tokens, self.output_tokens, self.thought = prompt_tokens, output_tokens, thought


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
        jobs: "Any | None" = None,
    ) -> None:
        self.settings = settings
        self._transport = transport
        self._gpu = asyncio.Semaphore(settings.concurrency)
        self.web = web
        """`research.WebTools`, or None when web search is off."""
        self.jobs = jobs
        """`job_tools.JobTools` for agents with the `jobs` tool, or None."""

    def model_for(self, agent: AgentSnapshot) -> str:
        return (agent.model or "").strip() or self.settings.model

    def reserve_for(self, data: StageInput) -> int:
        s = self.settings
        return reserve_tokens(data, num_ctx=s.num_ctx, minimum=s.reserve_tokens, think_tokens=s.think_tokens if s.think else 0)

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        web = self.web if data.agent.web_access else None
        jobs = self.jobs if AgentTool.JOBS in data.agent.tools else None
        if data.stage == TaskStage.RESEARCH and (web is not None or jobs is not None):
            from app.executor.research import run_research

            return await run_research(self, web, data, report, jobs)
        s = self.settings
        model = self.model_for(data.agent)
        messages = build_messages(data, num_ctx=s.num_ctx, reserve_tokens=self.reserve_for(data), today=date.today())
        turn = await self.generate(model, messages, report)
        if not turn.content:
            raise StageError("Модель вернула пустой ответ")
        text = strip_service_lines(turn.content) if data.stage in DELIVERABLE_STAGES else turn.content
        if data.stage == TaskStage.SELF_CHECK:
            text = finalize(text, data.jobs)
        return StageOutput(
            text=_keep_web_notes(data, text),
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
            think = s.think
            for attempt in range(1, attempts + 1):
                try:
                    async with asyncio.timeout(limit):
                        try:
                            return await self._chat(model, messages, report, tools, think)
                        except _ContextFull as full:
                            if not think:
                                raise self._context_error(full) from None
                            # thinking used up the window: the same request without thinking leaves it all to the answer
                            think = False
                            report.partial("")
                            try:
                                return await self._chat(model, messages, report, tools, think)
                            except _ContextFull as again:
                                raise self._context_error(again) from None
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

    def _context_error(self, full: _ContextFull) -> StageError:
        s = self.settings
        where = "на размышления, текст ответа не начат" if full.thought else "до текста ответа"
        return StageError(
            f"Ответ не поместился в окно контекста модели ({s.num_ctx} токенов): вход {full.prompt_tokens} токенов, "
            f"ещё {full.output_tokens} ушло {where}. Сократите описание или комментарии задачи "
            "или увеличьте OLLAMA_NUM_CTX в backend/.env."
        )

    async def _chat(
        self,
        model: str,
        messages: list[dict[str, Any]],
        report: StageReport,
        tools: list[dict[str, Any]] | None,
        think: bool | None = None,
    ) -> Turn:
        s = self.settings
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": s.think if think is None else think,
            "options": {"num_ctx": s.num_ctx, "temperature": s.temperature},
        }
        if tools:
            body["tools"] = tools
        turn = Turn()
        content: list[str] = []
        thought = False
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
                        thought = thought or bool(message.get("thinking"))
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
                                used = turn.input_tokens + turn.output_tokens
                                if chunk.get("done_reason") == "length" or used >= s.num_ctx - 8:
                                    raise _ContextFull(turn.input_tokens, turn.output_tokens, thought)
                                raise _Retryable(
                                    f"Модель закончила ответ, не написав текста (вход {turn.input_tokens} токенов, "
                                    f"вывод {turn.output_tokens}{', только размышления' if thought else ''})"
                                )
                            return turn
            except (httpx.ReadError, httpx.RemoteProtocolError, httpx.WriteError) as err:
                raise _Retryable(f"Соединение с Ollama оборвалось: {err}") from err
        raise _Retryable("Ollama закрыла поток, не завершив ответ")


DELIVERABLE_STAGES = frozenset({TaskStage.DRAFT, TaskStage.SELF_CHECK})

_SERVICE_LINE = re.compile(
    r"^(?:draft\b[^.\n]{0,40}\bfor\b[^.\n]{0,40}\breview\b"
    r"|(?:this is )?(?:a |the )?draft (?:prepared |written )?for (?:the )?director"
    r"|(?:status|note)\s*:\s*draft\b"
    r"|.{0,80}\bnothing (?:here |in this \w+ )?has been (?:sent|submitted|filed|published|applied)\b)",
    re.IGNORECASE,
)
_DECORATION = re.compile(r"^[\s#>*_\-–—:]+|[\s*_]+$")
_RULE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")


def strip_service_lines(text: str) -> str:
    """Drops the model's status lines ("DRAFT for director review", "nothing has been sent") from a deliverable."""
    lines = [line for line in text.splitlines() if not _SERVICE_LINE.match(_DECORATION.sub("", line))]
    while lines and (not lines[0].strip() or _RULE.match(lines[0])):
        lines.pop(0)
    while lines and (not lines[-1].strip() or _RULE.match(lines[-1])):
        lines.pop()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def _keep_web_notes(data: StageInput, text: str) -> str:
    """The final result keeps the note that web search was down, even when the model dropped it."""
    from app.executor.research import SEARCH_DOWN_NOTE

    notes = data.previous_stages.get(TaskStage.RESEARCH, "")
    if data.stage == TaskStage.SELF_CHECK and SEARCH_DOWN_NOTE in notes and SEARCH_DOWN_NOTE not in text:
        return f"{text}\n\n{SEARCH_DOWN_NOTE}"
    return text

