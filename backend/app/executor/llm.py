"""Stage worker backed by a local model in Ollama (`/api/chat`, streamed).

- GPU queue: at most `concurrency` requests in flight; an agent waiting for a slot reports `waiting`.
  The slot is held for one model call only, so tool calls (web) never block other agents.
- Ollama out of reach (not started, restarting, the connection dropped) is waited for, never a failure: the run
  shows `model_unavailable`, Ollama is polled with a growing pause, and the call goes on from the text already
  written (the partial answer is sent back as the start of the assistant message, which Ollama continues).
- A call times out only when the stream makes no progress for `idle_timeout` seconds (no thinking, no text), not
  after a fixed total; it is then retried once the same way. A 5xx or a stream error is retried `retries` times;
  a missing model is not retried.
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
    idle_timeout: float
    """Longest silence of the stream (from sending, then between chunks) before the call counts as stuck."""
    retries: int
    reserve_tokens: int
    think_tokens: int = 6144
    unavailable_wait: float = 5.0
    """First pause between checks while Ollama cannot be reached; doubles up to `unavailable_wait_max`."""
    unavailable_wait_max: float = 60.0


class ModelMissing(StageError):
    pass


class StageTimeout(StageError):
    pass


class _Retryable(Exception):
    """A failure worth one more try; becomes a `StageError` with the same code (plus `attempts`) when tries run out."""

    def __init__(self, message: str, code: str, params: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.params: dict[str, Any] = params or {}


class _Lost(Exception):
    """Ollama cannot be reached or the stream broke off; `written` is the answer text received so far."""

    def __init__(self, written: str) -> None:
        super().__init__("Ollama is not reachable")
        self.written = written


class _Idle(Exception):
    """The stream made no progress for `idle_timeout` seconds."""

    def __init__(self, written: str) -> None:
        super().__init__("no progress")
        self.written = written


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
        self._down = False
        """Ollama was out of reach at the last attempt: the next call checks it before sending."""
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
            raise StageError("The model returned an empty answer", "empty_answer")
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
    ) -> Turn:
        """One model call through the GPU queue (see the module notes for waiting, resuming and retries)."""
        s = self.settings
        if self._gpu.locked():
            await report.waiting()
        async with self._gpu:
            await self._until_reachable(report)
            await report.started()
            think = s.think
            written = ""
            stuck = failures = 0
            while True:
                try:
                    turn = await self._chat(model, messages, report, tools, think, written)
                except _Lost as lost:
                    written = lost.written
                    self._down = True
                    await self._until_reachable(report)
                    await report.started()
                    continue
                except _Idle as idle:
                    written = idle.written
                    stuck += 1
                    if stuck > s.retries:
                        raise StageTimeout(
                            f"Model “{model}” wrote nothing for {s.idle_timeout:g} s (attempts: {stuck}).",
                            "model_timeout",
                            {"model": model, "seconds": s.idle_timeout, "attempts": stuck},
                        ) from None
                    continue
                except _Retryable as err:
                    failures += 1
                    if failures > s.retries:
                        raise StageError(f"{err} (attempts: {failures})", err.code, {**err.params, "attempts": failures}) from None
                    report.partial(written)
                    continue
                except _ContextFull as full:
                    if not think:
                        raise self._context_error(full) from None
                    # thinking used up the window: the same request without thinking leaves it all to the answer
                    think = False
                    written = ""
                    report.partial("")
                    continue
                return turn

    @staticmethod
    async def _reachable(client: httpx.AsyncClient) -> bool:
        try:
            return (await client.get("/api/version")).status_code == 200
        except httpx.HTTPError:
            return False

    async def _until_reachable(self, report: StageReport) -> None:
        """Returns once Ollama answers; while it does not, the run shows why it waits."""
        if not self._down:
            return
        pause = self.settings.unavailable_wait
        told = False
        async with httpx.AsyncClient(base_url=self.settings.url, timeout=3, transport=self._transport) as client:
            while not await self._reachable(client):
                if not told:
                    await report.unavailable(self.settings.url)
                    told = True
                await asyncio.sleep(pause)
                pause = min(pause * 2, self.settings.unavailable_wait_max)
        self._down = False

    def _context_error(self, full: _ContextFull) -> StageError:
        s = self.settings
        where = "on thinking, before any answer text" if full.thought else "before the answer text"
        return StageError(
            f"The answer did not fit into the model's context window ({s.num_ctx} tokens): {full.prompt_tokens} "
            f"tokens of input, another {full.output_tokens} went {where}. Shorten the task description or comments "
            "or raise OLLAMA_NUM_CTX in backend/.env.",
            "context_full_thinking" if full.thought else "context_full",
            {"num_ctx": s.num_ctx, "input": full.prompt_tokens, "output": full.output_tokens},
        )

    async def _chat(
        self,
        model: str,
        messages: list[dict[str, Any]],
        report: StageReport,
        tools: list[dict[str, Any]] | None,
        think: bool | None = None,
        written: str = "",
    ) -> Turn:
        """One streamed request. `written` is the answer received before the connection broke: it goes back as the
        start of the assistant message and the model continues it."""
        s = self.settings
        prefix = written.rstrip()
        body: dict[str, Any] = {
            "model": model,
            "messages": [*messages, {"role": "assistant", "content": prefix}] if prefix else messages,
            "stream": True,
            "think": s.think if think is None else think,
            "options": {"num_ctx": s.num_ctx, "temperature": s.temperature},
        }
        if tools:
            body["tools"] = tools
        turn = Turn()
        content: list[str] = [prefix] if prefix else []
        thought = False
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout(s.idle_timeout) as idle:
                async with httpx.AsyncClient(base_url=s.url, timeout=httpx.Timeout(None, connect=5), transport=self._transport) as client:
                    async with client.stream("POST", "/api/chat", json=body) as response:
                        if response.status_code == 404:
                            raise ModelMissing(
                                f"Model “{model}” is not downloaded in Ollama. Run: ollama pull {model}", "model_missing", {"model": model}
                            )
                        if response.status_code >= 500:
                            detail = (await response.aread()).decode(errors="replace")[:300]
                            raise _Retryable(
                                f"Ollama returned an error {response.status_code}: {detail}",
                                "ollama_error",
                                {"status": response.status_code, "detail": detail},
                            )
                        if response.status_code >= 400:
                            detail = (await response.aread()).decode(errors="replace")[:300]
                            raise StageError(
                                f"Ollama rejected the request ({response.status_code}): {detail}",
                                "ollama_rejected",
                                {"status": response.status_code, "detail": detail},
                            )
                        async for line in response.aiter_lines():
                            idle.reschedule(loop.time() + s.idle_timeout)
                            if not line.strip():
                                continue
                            chunk = json.loads(line)
                            if "error" in chunk:
                                raise _Retryable(f"Ollama: {chunk['error']}", "ollama_stream_error", {"error": str(chunk["error"])})
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
                                        f"The model finished without writing any text ({turn.input_tokens} tokens of input, "
                                        f"{turn.output_tokens} of output{', thinking only' if thought else ''})",
                                        "no_text_thinking" if thought else "no_text",
                                        {"input": turn.input_tokens, "output": turn.output_tokens},
                                    )
                                return turn
        except TimeoutError:
            raise _Idle("".join(content)) from None
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError, httpx.RemoteProtocolError, httpx.WriteError):
            raise _Lost("".join(content)) from None
        raise _Lost("".join(content))


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

