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

    agents: Mapped[list["Agent"]] = relationship(back_populates="floor")
