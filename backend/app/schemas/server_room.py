from datetime import datetime

from pydantic import BaseModel

from app.models.enums import TaskStage


class LoadedModel(BaseModel):
    name: str
    size_gb: float
    vram_gb: float
    context_length: int | None
    expires_at: datetime | None


class OllamaInfo(BaseModel):
    up: bool
    url: str
    version: str | None = None
    models: list[LoadedModel] = []


class GpuInfo(BaseModel):
    name: str
    used_mb: int
    total_mb: int
    utilization: int


class LastSpeed(BaseModel):
    tokens_per_second: float
    model: str | None
    agent_title: str
    finished_at: datetime | None


class ModelUser(BaseModel):
    agent_id: int
    name: str
    title: str
    task_title: str
    stage: TaskStage
    since: datetime


class TokenRow(BaseModel):
    agent_id: int
    name: str
    title: str
    today_in: int
    today_out: int
    total_in: int
    total_out: int


class TokenTotals(BaseModel):
    today_in: int
    today_out: int
    total_in: int
    total_out: int


class ServerRoom(BaseModel):
    worker: str
    default_model: str
    ollama: OllamaInfo
    gpu: GpuInfo | None
    searxng_up: bool
    searxng_url: str
    last_speed: LastSpeed | None
    queue: list[ModelUser]
    """Waiting for the model, oldest first."""
    running: list[ModelUser]
    """Working with the model right now."""
    tokens: list[TokenRow]
    totals: TokenTotals
