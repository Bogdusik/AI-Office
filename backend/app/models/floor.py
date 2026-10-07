from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import FloorKind
from app.models.types import str_enum

if TYPE_CHECKING:
    from app.models.agent import Agent


class Floor(Base):
    __tablename__ = "floors"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'reception' AND capacity = 0) OR (kind = 'office' AND capacity > 0)",
            name="capacity_matches_kind",
        ),
        Index(
            "uq_floors_single_reception",
            "kind",
            unique=True,
            postgresql_where=text("kind = 'reception'"),
        ),
        CheckConstraint(
            "kind = 'office' OR (NOT has_server_room AND NOT has_kitchen)",
            name="rooms_on_office_floors",
        ),
        Index("uq_floors_single_server_room", "has_server_room", unique=True, postgresql_where=text("has_server_room")),
        Index("uq_floors_single_kitchen", "has_kitchen", unique=True, postgresql_where=text("has_kitchen")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[FloorKind] = mapped_column(
        str_enum(FloorKind, "floor_kind"), default=FloorKind.OFFICE, server_default=FloorKind.OFFICE
    )
    capacity: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    has_director_office: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    has_server_room: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    """The building's only server room (in the kitchen zone of this floor)."""
    has_kitchen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    """The building's only kitchen; set by migration/seed, not through the API."""

    agents: Mapped[list["Agent"]] = relationship(back_populates="floor")
