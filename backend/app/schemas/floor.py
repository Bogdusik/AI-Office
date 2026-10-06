from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import FloorKind
from app.schemas.common import NonEmptyStr, ORMModel, PatchModel


class FloorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    number: int
    name: NonEmptyStr = Field(max_length=100)
    kind: FloorKind = FloorKind.OFFICE
    capacity: int | None = Field(default=None, ge=0, description="Defaults to 5 for office, 0 for reception")
    has_director_office: bool = False


class FloorUpdate(PatchModel):
    number: int | None = None
    name: NonEmptyStr | None = Field(default=None, max_length=100)
    kind: FloorKind | None = None
    capacity: int | None = Field(default=None, ge=0)
    has_director_office: bool | None = None


class FloorRead(ORMModel):
    id: int
    number: int
    name: str
    kind: FloorKind
    capacity: int
    has_director_office: bool
