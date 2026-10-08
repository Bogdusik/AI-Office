from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.enums import TaskStatus
from app.schemas.task import CommentCreate, CommentRead, TaskCreate, TaskDetail, TaskRead
from app.services import tasks as service

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskRead], status_code=status.HTTP_200_OK)
async def list_tasks(
    agent_id: int | None = None,
    status_: TaskStatus | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
) -> list[TaskRead]:
    tasks = await service.list_tasks(db, agent_id=agent_id, status=status_)
    return [TaskRead.model_validate(t) for t in tasks]


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, db: AsyncSession = Depends(get_db)) -> TaskRead:
    return TaskRead.model_validate(await service.create_task(db, data))


@router.get("/{task_id}", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def read_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.get_task_detail(db, task_id))


@router.post("/{task_id}/approve", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def approve_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.approve(db, task_id))


@router.post(
    "/{task_id}/request-changes", response_model=TaskDetail, status_code=status.HTTP_200_OK
)
async def request_changes(
    task_id: int, data: CommentCreate, db: AsyncSession = Depends(get_db)
) -> TaskDetail:
    return TaskDetail.model_validate(await service.request_changes(db, task_id, data.body))


@router.post("/{task_id}/pause", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def pause_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.pause(db, task_id))


@router.post("/{task_id}/resume", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def resume_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.resume(db, task_id))


@router.post("/{task_id}/retry", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def retry_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.retry(db, task_id))


@router.post("/{task_id}/cancel", response_model=TaskDetail, status_code=status.HTTP_200_OK)
async def cancel_task(task_id: int, db: AsyncSession = Depends(get_db)) -> TaskDetail:
    return TaskDetail.model_validate(await service.cancel(db, task_id))


@router.post(
    "/{task_id}/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED
)
async def add_comment(
    task_id: int, data: CommentCreate, db: AsyncSession = Depends(get_db)
) -> CommentRead:
    return CommentRead.model_validate(await service.add_comment(db, task_id, data.body))
