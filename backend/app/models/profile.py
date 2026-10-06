from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

PROFILE_ID = 1


class Profile(Base):
    __tablename__ = "profile"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=PROFILE_ID, autoincrement=False)
    name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    goal: Mapped[str] = mapped_column(Text, default="", server_default="")
    constraints: Mapped[str] = mapped_column(Text, default="", server_default="")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
