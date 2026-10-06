from typing import Annotated, Any, ClassVar

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PatchModel(BaseModel):
    """Partial update: omitted fields stay untouched, explicit null only where allowed."""

    model_config = ConfigDict(extra="forbid")
    nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_required(cls, data: Any) -> Any:
        if isinstance(data, dict):
            bad = [k for k, v in data.items() if v is None and k not in cls.nullable_fields]
            if bad:
                raise ValueError(f"Fields cannot be null: {', '.join(sorted(bad))}")
        return data

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)
