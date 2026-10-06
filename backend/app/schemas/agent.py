from datetime import datetime
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AgentStatus, Provider
from app.schemas.common import NonEmptyStr, ORMModel, PatchModel


class AgentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    floor_id: int
    name: NonEmptyStr = Field(max_length=100)
    role_key: NonEmptyStr = Field(max_length=64)
    title: NonEmptyStr = Field(max_length=200)
    system_prompt: str = ""
    provider: Provider = Provider.OLLAMA
    model: str | None = Field(default=None, max_length=200)
    web_access: bool = False
    desk_index: int | None = Field(default=None, ge=0)


class AgentUpdate(PatchModel):
    nullable_fields: ClassVar[frozenset[str]] = frozenset({"model"})

    floor_id: int | None = None
    name: NonEmptyStr | None = Field(default=None, max_length=100)
    role_key: NonEmptyStr | None = Field(default=None, max_length=64)
    title: NonEmptyStr | None = Field(default=None, max_length=200)
    system_prompt: str | None = None
    provider: Provider | None = None
    model: str | None = Field(default=None, max_length=200)
    web_access: bool | None = None
    desk_index: int | None = Field(default=None, ge=0)


class AgentRead(ORMModel):
    id: int
    floor_id: int | None
    name: str
    role_key: str
    title: str
    system_prompt: str
    provider: Provider
    model: str | None
    web_access: bool
    desk_index: int | None
    status: AgentStatus
    archived_at: datetime | None
