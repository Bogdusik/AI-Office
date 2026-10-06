from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import NonEmptyStr, ORMModel, PatchModel


class FloorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    number: int
    name: NonEmptyStr = Field(max_length=100)
    capacity: int = Field(default=5, ge=1)
    has_director_office: bool = False


class FloorUpdate(PatchModel):
    number: int | None = None
    name: NonEmptyStr | None = Field(default=None, max_length=100)
    capacity: int | None = Field(default=None, ge=1)
    has_director_office: bool | None = None


class FloorRead(ORMModel):
    id: int
    number: int
    name: str
    capacity: int
    has_director_office: bool
