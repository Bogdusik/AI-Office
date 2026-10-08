from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import CommentAuthor, RunProvider, RunStatus, TaskStage, TaskStatus
from app.models.types import str_enum

if TYPE_CHECKING:
    from app.models.agent import Agent


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_agent_status_position", "agent_id", "status", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[TaskStatus] = mapped_column(
        str_enum(TaskStatus, "task_status"),
        default=TaskStatus.QUEUED,
        server_default=TaskStatus.QUEUED,
    )
    stage: Mapped[TaskStage | None] = mapped_column(str_enum(TaskStage, "task_stage"))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    agent: Mapped["Agent"] = relationship(back_populates="tasks")
    comments: Mapped[list["TaskComment"]] = relationship(
        back_populates="task", order_by="TaskComment.id", passive_deletes=True
    )
    runs: Mapped[list["Run"]] = relationship(
        back_populates="task", order_by="Run.id", passive_deletes=True
    )
    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="task", order_by="Artifact.version", passive_deletes=True
    )


class TaskComment(Base):
    __tablename__ = "task_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    author: Mapped[CommentAuthor] = mapped_column(str_enum(CommentAuthor, "comment_author"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped[Task] = relationship(back_populates="comments")


class Run(Base):
    """One stage of one attempt; `attempt` is the artifact version the run works towards."""

    __tablename__ = "runs"
    __table_args__ = (Index("ix_runs_task_attempt", "task_id", "attempt"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    stage: Mapped[TaskStage] = mapped_column(str_enum(TaskStage, "run_stage"))
    provider: Mapped[RunProvider] = mapped_column(str_enum(RunProvider, "run_provider"))
    model: Mapped[str | None] = mapped_column(String(200))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[RunStatus] = mapped_column(
        str_enum(RunStatus, "run_status"),
        default=RunStatus.RUNNING,
        server_default=RunStatus.RUNNING,
    )
    error: Mapped[str | None] = mapped_column(Text)
    output: Mapped[str] = mapped_column(Text, default="", server_default="")
    sources: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    activity: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list, server_default="[]")
    """Web steps of the stage (searches, pages, job searches) as shown to the director."""
    jobs: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    """Vacancies found by the job tools in this stage (`app.jobs.report`), None when they were not used."""
    tokens_per_second: Mapped[float | None] = mapped_column(Float)
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    task: Mapped[Task] = relationship(back_populates="runs")


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (UniqueConstraint("task_id", "version", name="uq_artifacts_task_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    sources: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    jobs: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    """The vacancies behind this version (eligible and excluded), copied from its research run."""
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped[Task] = relationship(back_populates="artifacts")
