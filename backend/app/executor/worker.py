"""The work on one stage of a task, hidden behind `StageWorker`.

The executor builds a `StageInput` from plain snapshots (no ORM objects, no session) and stores whatever
`StageOutput` comes back. `LlmWorker` (a local model) and `FakeWorker` (no model, for the demo and tests) are interchangeable.
"""

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from app.models.enums import CommentAuthor, RunProvider, TaskStage


@dataclass(frozen=True)
class ProfileSnapshot:
    name: str
    summary: str
    goal: str
    constraints: str
    notes: str


@dataclass(frozen=True)
class AgentSnapshot:
    id: int
    name: str
    title: str
    system_prompt: str
    model: str | None
    web_access: bool
    tools: tuple[str, ...] = ()
    """Tool sets besides the web (`AgentTool` values)."""


@dataclass(frozen=True)
class TaskSnapshot:
    id: int
    title: str
    description: str


@dataclass(frozen=True)
class CommentSnapshot:
    author: CommentAuthor
    body: str
    created_at: datetime


@dataclass(frozen=True)
class StageInput:
    task: TaskSnapshot
    stage: TaskStage
    version: int
    profile: ProfileSnapshot
    agent: AgentSnapshot
    comments: tuple[CommentSnapshot, ...]
    previous_stages: Mapping[TaskStage, str]
    """Outputs of the stages already done for this version."""
    previous_results: tuple[str, ...]
    """Earlier versions of the result, oldest first."""
    jobs: Mapping[str, object] | None = None
    """What the job tools found in this version's research stage (`job_tools.JobSession.report`)."""
    job_calls_used: int = 0
    """Job tool calls already spent on this task (earlier versions and attempts)."""


@dataclass(frozen=True)
class StageOutput:
    text: str
    input_tokens: int
    output_tokens: int
    sources: tuple[str, ...] = field(default_factory=tuple)
    tokens_per_second: float | None = None
    """Generation speed of the last model call, as reported by the model server."""
    jobs: Mapping[str, object] | None = None
    """Job tools report of a research stage, saved on the run."""


ActivityStep = dict[str, object]
"""One web step shown to the director: {id, kind: search|fetch, target, status: running|done|failed, detail, source}."""


class StageError(Exception):
    """A failure whose message is meant for the director (stored as the run's error as is)."""


class StageReport(Protocol):
    """How a worker tells the executor what is happening while a stage runs."""

    async def waiting(self) -> None:
        """Queued for a shared resource (the GPU); the request has not been sent yet."""

    async def started(self) -> None:
        """The request has really been sent; waiting is over."""

    def partial(self, text: str) -> None:
        """Text produced so far; the executor saves it at its own pace."""

    async def activity(self, steps: list[ActivityStep]) -> None:
        """All web steps of this stage so far (searches, pages); saved right away."""


class StageWorker(Protocol):
    provider: RunProvider

    def model_for(self, agent: AgentSnapshot) -> str | None:
        """Model the run will use, recorded on the run."""

    async def run(self, data: StageInput, report: StageReport) -> StageOutput: ...


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _input_text(data: StageInput) -> str:
    return "\n".join(
        [
            data.agent.system_prompt,
            data.profile.summary,
            data.profile.goal,
            data.profile.constraints,
            data.profile.notes,
            data.task.title,
            data.task.description,
            *(c.body for c in data.comments),
            *data.previous_stages.values(),
            *data.previous_results,
        ]
    )


FAKE_STEPS = 40
"""The fake worker shows its text in this many steps, as a model streams it."""


class FakeWorker:
    """Types a placeholder in Russian over `delay` seconds, word by word; marks its runs as provider `fake`."""

    provider = RunProvider.FAKE

    def __init__(self, delay: float) -> None:
        self.delay = delay

    def model_for(self, agent: AgentSnapshot) -> str | None:
        return None

    async def run(self, data: StageInput, report: StageReport) -> StageOutput:
        await report.started()
        text = self._text(data)
        words = text.split(" ")
        steps = min(FAKE_STEPS, len(words))
        for step in range(1, steps + 1):
            await asyncio.sleep(self.delay / steps)
            report.partial(" ".join(words[: len(words) * step // steps]))
        return StageOutput(text=text, input_tokens=estimate_tokens(_input_text(data)), output_tokens=estimate_tokens(text))

    @staticmethod
    def _text(data: StageInput) -> str:
        title = data.task.title
        director = [c.body for c in data.comments if c.author == CommentAuthor.DIRECTOR]
        notes = "\n".join(f"- {body}" for body in director)
        match data.stage:
            case TaskStage.PLAN:
                return f"План (заглушка) по задаче «{title}»:\n1. Разобрать условие.\n2. Собрать материалы.\n3. Написать черновик и проверить его."
            case TaskStage.RESEARCH:
                return "Исследование (заглушка): фальшивый исполнитель не ищет в сети, источники не собирались."
            case TaskStage.DRAFT:
                base = f"Черновик версии {data.version} (заглушка) по задаче «{title}»."
                return f"{base}\nУчтены комментарии директора:\n{notes}" if director else base
            case TaskStage.SELF_CHECK:
                parts = [
                    f"# {title}",
                    f"Результат, версия {data.version} — заглушка фальшивого исполнителя (EXECUTOR_WORKER=fake). "
                    "Настоящий текст пишет локальная модель: EXECUTOR_WORKER=llm.",
                ]
                if data.task.description:
                    parts.append(f"## Задача\n{data.task.description}")
                if director:
                    parts.append(f"## Учтённые комментарии директора\n{notes}")
                parts.append(f"## Самопроверка\nЭтапов пройдено: {len(data.previous_stages) + 1}. Замечаний нет.")
                return "\n\n".join(parts)
