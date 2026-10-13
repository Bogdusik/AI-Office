from datetime import date

from sqlalchemy import Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JobApiUsage(Base):
    """Requests sent to a job API on one UTC day; the daily limit is checked against it (keys may be shared with
    other projects, so the count survives restarts)."""

    __tablename__ = "job_api_usage"

    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
