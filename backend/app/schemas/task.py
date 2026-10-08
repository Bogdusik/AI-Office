from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CommentAuthor, RunProvider, RunStatus, TaskStage, TaskStatus
from app.schemas.common import NonEmptyStr, ORMModel


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: int
    title: NonEmptyStr = Field(max_length=300)
    description: str = ""


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: NonEmptyStr


class TaskRead(ORMModel):
    id: int
    agent_id: int
    title: str
    description: str
    status: TaskStatus
    stage: TaskStage | None
    position: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class CommentRead(ORMModel):
    id: int
    author: CommentAuthor
    body: str
    created_at: datetime


class RunRead(ORMModel):
    id: int
    stage: TaskStage
    attempt: int
    provider: RunProvider
    model: str | None
    input_tokens: int
    output_tokens: int
    status: RunStatus
    error: str | None
    output: str
    sources: list[str]
    activity: list[dict[str, object]]
    jobs: dict[str, object] | None
    tokens_per_second: float | None
    started_at: datetime
    finished_at: datetime | None


class ArtifactRead(ORMModel):
    id: int
    version: int
    content: str
    sources: list[str]
    jobs: dict[str, object] | None
    created_at: datetime


class TaskDetail(TaskRead):
    comments: list[CommentRead]
    runs: list[RunRead]
    artifacts: list[ArtifactRead]
