from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import AgentStatus, Provider
from app.models.types import str_enum

if TYPE_CHECKING:
    from app.models.floor import Floor
    from app.models.task import Task


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("floor_id", "desk_index", name="uq_agents_floor_desk"),
        CheckConstraint("desk_index >= 0", name="desk_index_non_negative"),
        CheckConstraint(
            "(archived_at IS NULL AND floor_id IS NOT NULL AND desk_index IS NOT NULL)"
            " OR (archived_at IS NOT NULL AND floor_id IS NULL AND desk_index IS NULL)",
            name="placement_matches_archive",
        ),
        Index(
            "uq_agents_role_key_active",
            "role_key",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_id: Mapped[int | None] = mapped_column(
        ForeignKey("floors.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    role_key: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    system_prompt: Mapped[str] = mapped_column(Text, default="", server_default="")
    provider: Mapped[Provider] = mapped_column(
        str_enum(Provider, "provider"), default=Provider.OLLAMA, server_default=Provider.OLLAMA
    )
    model: Mapped[str | None] = mapped_column(String(200))
    web_access: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    desk_index: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[AgentStatus] = mapped_column(
        str_enum(AgentStatus, "agent_status"),
        default=AgentStatus.OFF_SITE,
        server_default=AgentStatus.OFF_SITE,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    floor: Mapped["Floor | None"] = relationship(back_populates="agents")
    tasks: Mapped[list["Task"]] = relationship(back_populates="agent")
