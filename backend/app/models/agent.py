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
    func,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import AgentStatus, Provider, TripKind
from app.models.types import str_enum

if TYPE_CHECKING:
    from app.models.floor import Floor
    from app.models.task import Task


TRIP_OF = {AgentStatus.ARRIVING: TripKind.ARRIVE, AgentStatus.LEAVING: TripKind.DEPART}


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("floor_id", "desk_index", name="uq_agents_floor_desk"),
        CheckConstraint("desk_index >= 0", name="desk_index_non_negative"),
        CheckConstraint("(trip_kind IS NULL) = (trip_started_at IS NULL)", name="trip_complete"),
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
    status_since: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    trip_kind: Mapped[TripKind | None] = mapped_column(str_enum(TripKind, "trip_kind"))
    trip_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """The latest trip (arriving or leaving); kept after it ends so the scene can plan around it."""
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def set_status(self, status: AgentStatus, at: datetime) -> None:
        """Every status change goes through here: it stamps the start of the status and of a trip."""
        self.status = status
        self.status_since = at
        trip = TRIP_OF.get(status)
        if trip is not None:
            self.trip_kind = trip
            self.trip_started_at = at

    floor: Mapped["Floor | None"] = relationship(back_populates="agents")
    tasks: Mapped[list["Task"]] = relationship(back_populates="agent")
