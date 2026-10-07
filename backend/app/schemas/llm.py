from typing import Literal

from pydantic import BaseModel


class LlmStatus(BaseModel):
    worker: Literal["fake", "llm"]
    ok: bool
    model: str | None
    ollama: bool | None = None
    version: str | None = None
    available: bool | None = None
    loaded: bool | None = None
    message: str | None = None
