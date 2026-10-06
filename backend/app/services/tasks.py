from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.events import publish_task
from app.models import Task, TaskComment
from app.models.enums import CommentAuthor, TaskStatus
from app.schemas.task import TaskCreate
from app.services import rules
from app.services.agents import ensure_active, get_agent
from app.services.errors import ConflictError, NotFoundError

STARTABLE = frozenset({TaskStatus.QUEUED, TaskStatus.CHANGES_REQUESTED})


async def list_tasks(
    session: AsyncSession, *, agent_id: int | None = None, status: TaskStatus | None = None
) -> Sequence[Task]:
    stmt = select(Task).order_by(Task.id)
    if agent_id is not None:
        stmt = stmt.where(Task.agent_id == agent_id)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    result = await session.scalars(stmt)
    return result.all()


async def get_task(session: AsyncSession, task_id: int, *, lock: bool = False) -> Task:
    stmt = select(Task).where(Task.id == task_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    task = await session.scalar(stmt)
    if task is None:
        raise NotFoundError(f"Task {task_id} not found")
    return task


async def get_task_detail(session: AsyncSession, task_id: int) -> Task:
    task = await session.scalar(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.comments),
            selectinload(Task.runs),
            selectinload(Task.artifacts),
        )
        .execution_options(populate_existing=True)
    )
    if task is None:
        raise NotFoundError(f"Task {task_id} not found")
    return task


async def create_task(session: AsyncSession, data: TaskCreate) -> Task:
    agent = await get_agent(session, data.agent_id, lock=True)
    ensure_active(agent)
    last = await session.scalar(select(func.max(Task.position)).where(Task.agent_id == agent.id))
    task = Task(
        agent_id=agent.id,
        title=data.title,
        description=data.description,
        status=TaskStatus.QUEUED,
        position=(last or 0) + 1,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    publish_task(task)
    return task


def apply_transition(task: Task, target: TaskStatus, now: datetime) -> None:
    rules.ensure_transition(task.status, target)
    stamps = rules.transition_timestamps(target, task.started_at, task.finished_at, now)
    task.status = target
    task.started_at = stamps.started_at
    task.finished_at = stamps.finished_at


async def _transition(
    session: AsyncSession, task_id: int, target: TaskStatus, comment: str | None = None
) -> Task:
    task = await get_task(session, task_id, lock=True)
    apply_transition(task, target, datetime.now(UTC))
    if comment is not None:
        session.add(TaskComment(task_id=task.id, author=CommentAuthor.DIRECTOR, body=comment))
    await session.commit()
    publish_task(task)
    return await get_task_detail(session, task.id)


async def approve(session: AsyncSession, task_id: int) -> Task:
    return await _transition(session, task_id, TaskStatus.DONE)


async def request_changes(session: AsyncSession, task_id: int, body: str | None) -> Task:
    comment = rules.ensure_review_comment(body)
    return await _transition(session, task_id, TaskStatus.CHANGES_REQUESTED, comment)


async def pause(session: AsyncSession, task_id: int) -> Task:
    return await _transition(session, task_id, TaskStatus.PAUSED)


async def resume(session: AsyncSession, task_id: int) -> Task:
    """A paused task goes back to the front of its agent's queue and later continues from its next stage."""
    task = await get_task(session, task_id, lock=True)
    if task.status != TaskStatus.PAUSED:
        raise ConflictError(f"Cannot resume a task in status '{task.status}'")
    queued = await session.scalars(
        select(Task.position).where(Task.agent_id == task.agent_id, Task.status == TaskStatus.QUEUED)
    )
    task.position = rules.front_position(queued.all(), task.position)
    apply_transition(task, TaskStatus.QUEUED, datetime.now(UTC))
    await session.commit()
    publish_task(task)
    return await get_task_detail(session, task.id)


async def cancel(session: AsyncSession, task_id: int) -> Task:
    return await _transition(session, task_id, TaskStatus.CANCELLED)


async def start(session: AsyncSession, task_id: int) -> Task:
    task = await get_task(session, task_id)
    if task.status not in STARTABLE:
        raise rules.TransitionError(task.status, TaskStatus.IN_PROGRESS)
    return await _transition(session, task_id, TaskStatus.IN_PROGRESS)


async def submit_for_review(session: AsyncSession, task_id: int) -> Task:
    return await _transition(session, task_id, TaskStatus.NEEDS_REVIEW)


async def fail(session: AsyncSession, task_id: int) -> Task:
    return await _transition(session, task_id, TaskStatus.FAILED)


async def add_comment(
    session: AsyncSession, task_id: int, body: str, author: CommentAuthor = CommentAuthor.DIRECTOR
) -> TaskComment:
    task = await get_task(session, task_id)
    comment = TaskComment(task_id=task.id, author=author, body=body)
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    return comment
