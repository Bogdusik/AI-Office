from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=200)
    summary: str
    goal: str
    constraints: str
    notes: str


class ProfileRead(ORMModel):
    name: str
    summary: str
    goal: str
    constraints: str
    notes: str
    updated_at: datetime
