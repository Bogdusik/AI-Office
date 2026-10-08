from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TypeVar

from app.models.enums import FloorKind, TaskStage, TaskStatus
from app.services.errors import ConflictError, ValidationFailedError

TERMINAL_STATUSES: frozenset[TaskStatus] = frozenset(
    {TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED}
)
ACTIVE_STATUSES: frozenset[TaskStatus] = frozenset(TaskStatus) - TERMINAL_STATUSES

ALLOWED_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.QUEUED: frozenset({TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED}),
    TaskStatus.IN_PROGRESS: frozenset(
        {TaskStatus.NEEDS_REVIEW, TaskStatus.PAUSED, TaskStatus.FAILED, TaskStatus.CANCELLED}
    ),
    # Resume puts a paused task back into the queue; only the executor moves it to in_progress again.
    TaskStatus.PAUSED: frozenset({TaskStatus.QUEUED, TaskStatus.CANCELLED}),
    TaskStatus.NEEDS_REVIEW: frozenset(
        {TaskStatus.DONE, TaskStatus.CHANGES_REQUESTED, TaskStatus.CANCELLED}
    ),
    TaskStatus.CHANGES_REQUESTED: frozenset({TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED}),
    TaskStatus.DONE: frozenset(),
    # Retry puts a failed task back into the queue; it continues from the stage that failed.
    TaskStatus.FAILED: frozenset({TaskStatus.QUEUED}),
    TaskStatus.CANCELLED: frozenset(),
}

CURRENT_TASK_PRIORITY: tuple[TaskStatus, ...] = (
    TaskStatus.IN_PROGRESS,
    TaskStatus.CHANGES_REQUESTED,
    TaskStatus.PAUSED,
    TaskStatus.NEEDS_REVIEW,
)


EXECUTOR_PICK_ORDER: tuple[TaskStatus, ...] = (
    TaskStatus.IN_PROGRESS,
    TaskStatus.CHANGES_REQUESTED,
    TaskStatus.QUEUED,
)
"""What an agent works on next: unfinished work first (after a restart), then rework, then the queue."""


def task_stages(*, web_access: bool, version: int, tools: Sequence[str] = ()) -> tuple[TaskStage, ...]:
    """Stages that produce result `version`. Rework (version 2+) skips the plan and starts from the
    director's comments and the previous result; research needs web access or a tool. The single place to change it."""
    stages: list[TaskStage] = []
    if version <= 1:
        stages.append(TaskStage.PLAN)
    if web_access or tools:
        stages.append(TaskStage.RESEARCH)
    stages += [TaskStage.DRAFT, TaskStage.SELF_CHECK]
    return tuple(stages)


def next_stage(stages: Sequence[TaskStage], done: Iterable[TaskStage]) -> TaskStage | None:
    """First stage of the attempt that has no successful run yet; None when the attempt is complete."""
    finished = set(done)
    return next((s for s in stages if s not in finished), None)


def front_position(positions: Iterable[int], fallback: int) -> int:
    """Queue position that goes before every given one."""
    return min(positions, default=fallback + 1) - 1


class TransitionError(ConflictError):
    def __init__(self, current: TaskStatus, target: TaskStatus) -> None:
        super().__init__(f"Cannot move task from '{current}' to '{target}'")
        self.current = current
        self.target = target


def can_transition(current: TaskStatus, target: TaskStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def ensure_transition(current: TaskStatus, target: TaskStatus) -> None:
    if not can_transition(current, target):
        raise TransitionError(current, target)


@dataclass(frozen=True)
class Timestamps:
    started_at: datetime | None
    finished_at: datetime | None


def transition_timestamps(
    target: TaskStatus,
    started_at: datetime | None,
    finished_at: datetime | None,
    now: datetime,
) -> Timestamps:
    if target == TaskStatus.IN_PROGRESS and started_at is None:
        started_at = now
    if target in TERMINAL_STATUSES:
        finished_at = now
    return Timestamps(started_at=started_at, finished_at=finished_at)


DEFAULT_CAPACITY: dict[FloorKind, int] = {FloorKind.OFFICE: 5, FloorKind.RECEPTION: 0}


def default_capacity(kind: FloorKind) -> int:
    return DEFAULT_CAPACITY[kind]


def ensure_capacity_matches_kind(kind: FloorKind, capacity: int) -> None:
    if kind == FloorKind.RECEPTION and capacity != 0:
        raise ValidationFailedError("A reception floor has no desks: capacity must be 0")
    if kind == FloorKind.OFFICE and capacity <= 0:
        raise ValidationFailedError("An office floor needs at least one desk: capacity must be > 0")


def ensure_floor_accepts_agents(kind: FloorKind) -> None:
    if kind != FloorKind.OFFICE:
        raise ConflictError("Agents can only work on office floors")


def ensure_floor_has_room(active_agents: int, capacity: int) -> None:
    if active_agents >= capacity:
        raise ConflictError(f"Floor is full ({active_agents}/{capacity})")


def ensure_capacity_fits(active_agents: int, capacity: int) -> None:
    if capacity < active_agents:
        raise ConflictError(
            f"Capacity {capacity} is below the number of agents on the floor ({active_agents})"
        )


def ensure_desk_in_range(desk_index: int, capacity: int) -> None:
    if not 0 <= desk_index < capacity:
        raise ConflictError(f"Desk {desk_index} does not exist on a floor of capacity {capacity}")


def ensure_floor_deletable(kind: FloorKind, has_director_office: bool) -> None:
    if kind == FloorKind.RECEPTION:
        raise ConflictError("The reception floor cannot be deleted")
    if has_director_office:
        raise ConflictError("The floor with the director's office cannot be deleted")


def ensure_floor_empty(active_agents: int) -> None:
    if active_agents > 0:
        raise ConflictError(f"Floor has {active_agents} agent(s); move or archive them first")


def ensure_no_active_tasks(active_tasks: int) -> None:
    if active_tasks > 0:
        raise ConflictError(f"Agent has {active_tasks} unfinished task(s)")


def first_free_desk(taken: Iterable[int], capacity: int) -> int:
    used = set(taken)
    for desk in range(capacity):
        if desk not in used:
            return desk
    raise ConflictError(f"Floor is full ({len(used)}/{capacity})")


def ensure_review_comment(body: str | None) -> str:
    cleaned = (body or "").strip()
    if not cleaned:
        raise ValidationFailedError("A director comment is required to request changes")
    return cleaned


class _Queued(Protocol):
    @property
    def id(self) -> int: ...
    @property
    def status(self) -> TaskStatus: ...
    @property
    def position(self) -> int: ...


T = TypeVar("T", bound=_Queued)


def pick_current_task(tasks: Sequence[T]) -> T | None:
    candidates = [t for t in tasks if t.status in CURRENT_TASK_PRIORITY]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda t: (CURRENT_TASK_PRIORITY.index(t.status), t.position, t.id),
    )


def pick_next_task(tasks: Sequence[T]) -> T | None:
    candidates = [t for t in tasks if t.status in EXECUTOR_PICK_ORDER]
    if not candidates:
        return None
    return min(candidates, key=lambda t: (EXECUTOR_PICK_ORDER.index(t.status), t.position, t.id))
