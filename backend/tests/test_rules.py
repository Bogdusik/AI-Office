from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import product

import pytest

from app.models.enums import TaskStage
from app.models.enums import TaskStatus as S
from app.services import rules
from app.services.errors import ConflictError, ValidationFailedError

NON_TERMINAL = [S.QUEUED, S.IN_PROGRESS, S.PAUSED, S.NEEDS_REVIEW, S.CHANGES_REQUESTED]

EXPECTED_ALLOWED = {
    (S.QUEUED, S.IN_PROGRESS),
    (S.IN_PROGRESS, S.NEEDS_REVIEW),
    (S.NEEDS_REVIEW, S.DONE),
    (S.NEEDS_REVIEW, S.CHANGES_REQUESTED),
    (S.CHANGES_REQUESTED, S.IN_PROGRESS),
    (S.IN_PROGRESS, S.PAUSED),
    (S.PAUSED, S.QUEUED),
    (S.IN_PROGRESS, S.FAILED),
    *((s, S.CANCELLED) for s in NON_TERMINAL),
}


@pytest.mark.parametrize(("current", "target"), list(product(S, S)))
def test_transition_matrix(current: S, target: S) -> None:
    allowed = (current, target) in EXPECTED_ALLOWED
    assert rules.can_transition(current, target) is allowed
    if allowed:
        rules.ensure_transition(current, target)
    else:
        with pytest.raises(rules.TransitionError):
            rules.ensure_transition(current, target)


def test_transition_error_is_conflict() -> None:
    with pytest.raises(ConflictError, match="from 'done' to 'in_progress'"):
        rules.ensure_transition(S.DONE, S.IN_PROGRESS)


def test_started_at_is_set_once() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    first = rules.transition_timestamps(S.IN_PROGRESS, None, None, t0)
    assert first.started_at == t0
    again = rules.transition_timestamps(S.IN_PROGRESS, t0, None, t0 + timedelta(hours=1))
    assert again.started_at == t0
    assert again.finished_at is None


@pytest.mark.parametrize("target", [S.DONE, S.FAILED, S.CANCELLED])
def test_finished_at_on_terminal(target: S) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert rules.transition_timestamps(target, None, None, now).finished_at == now


@pytest.mark.parametrize("target", [S.PAUSED, S.NEEDS_REVIEW, S.CHANGES_REQUESTED])
def test_no_finished_at_on_non_terminal(target: S) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert rules.transition_timestamps(target, now, None, now).finished_at is None


def test_floor_has_room() -> None:
    rules.ensure_floor_has_room(4, 5)
    with pytest.raises(ConflictError):
        rules.ensure_floor_has_room(5, 5)


def test_capacity_fits() -> None:
    rules.ensure_capacity_fits(3, 3)
    with pytest.raises(ConflictError):
        rules.ensure_capacity_fits(4, 3)


def test_floor_empty() -> None:
    rules.ensure_floor_empty(0)
    with pytest.raises(ConflictError):
        rules.ensure_floor_empty(1)


def test_desk_range_and_first_free() -> None:
    rules.ensure_desk_in_range(4, 5)
    with pytest.raises(ConflictError):
        rules.ensure_desk_in_range(5, 5)
    assert rules.first_free_desk({0, 1, 3}, 5) == 2
    with pytest.raises(ConflictError):
        rules.first_free_desk({0, 1}, 2)


def test_no_active_tasks() -> None:
    rules.ensure_no_active_tasks(0)
    with pytest.raises(ConflictError):
        rules.ensure_no_active_tasks(2)


@pytest.mark.parametrize("body", [None, "", "   \n\t"])
def test_review_comment_required(body: str | None) -> None:
    with pytest.raises(ValidationFailedError):
        rules.ensure_review_comment(body)


def test_review_comment_is_stripped() -> None:
    assert rules.ensure_review_comment("  fix sources \n") == "fix sources"


@dataclass
class FakeTask:
    id: int
    status: S
    position: int


def test_pick_current_task_priority() -> None:
    queued = FakeTask(1, S.QUEUED, 1)
    review = FakeTask(2, S.NEEDS_REVIEW, 2)
    paused = FakeTask(3, S.PAUSED, 3)
    changes = FakeTask(4, S.CHANGES_REQUESTED, 4)
    working = FakeTask(5, S.IN_PROGRESS, 5)

    assert rules.pick_current_task([queued]) is None
    assert rules.pick_current_task([queued, review]) is review
    assert rules.pick_current_task([review, paused]) is paused
    assert rules.pick_current_task([review, paused, changes]) is changes
    assert rules.pick_current_task([review, paused, changes, working]) is working


def test_pick_current_task_tie_breaks_by_position() -> None:
    later = FakeTask(1, S.PAUSED, 7)
    earlier = FakeTask(2, S.PAUSED, 3)
    assert rules.pick_current_task([later, earlier]) is earlier


P, R, D, C = TaskStage.PLAN, TaskStage.RESEARCH, TaskStage.DRAFT, TaskStage.SELF_CHECK


@pytest.mark.parametrize(
    ("web_access", "version", "expected"),
    [
        (False, 1, (P, D, C)),
        (True, 1, (P, R, D, C)),
        (False, 2, (D, C)),
        (True, 2, (R, D, C)),
        (True, 5, (R, D, C)),
    ],
)
def test_task_stages(web_access: bool, version: int, expected: tuple[TaskStage, ...]) -> None:
    assert rules.task_stages(web_access=web_access, version=version) == expected


def test_next_stage_skips_finished_ones() -> None:
    stages = rules.task_stages(web_access=True, version=1)
    assert rules.next_stage(stages, []) == P
    assert rules.next_stage(stages, [P]) == R
    assert rules.next_stage(stages, [P, R, D]) == C
    assert rules.next_stage(stages, stages) is None


def test_pick_next_task_order() -> None:
    queued_late = FakeTask(1, S.QUEUED, 9)
    queued_early = FakeTask(2, S.QUEUED, 2)
    rework = FakeTask(3, S.CHANGES_REQUESTED, 5)
    running = FakeTask(4, S.IN_PROGRESS, 7)
    review = FakeTask(5, S.NEEDS_REVIEW, 1)
    paused = FakeTask(6, S.PAUSED, 0)
    assert rules.pick_next_task([queued_late, queued_early, rework, running, review, paused]) is running
    assert rules.pick_next_task([queued_late, queued_early, rework, review]) is rework
    assert rules.pick_next_task([queued_late, queued_early, review]) is queued_early
    assert rules.pick_next_task([review, paused]) is None


def test_front_position() -> None:
    assert rules.front_position([3, 5], fallback=9) == 2
    assert rules.front_position([], fallback=9) == 9
