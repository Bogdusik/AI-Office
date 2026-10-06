from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.agent import Agent


class Floor(Base):
    __tablename__ = "floors"
    __table_args__ = (CheckConstraint("capacity > 0", name="capacity_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(100))
    capacity: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    has_director_office: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )

    agents: Mapped[list["Agent"]] = relationship(back_populates="floor")
