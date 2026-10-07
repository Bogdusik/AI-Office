from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str
    test_database_url: str | None = None
    cors_origins: list[str] = ["http://localhost:3000"]

    executor_enabled: bool = True
    executor_arrive_seconds: float = 5.0
    executor_stage_seconds: float = 5.0
    executor_depart_seconds: float = 5.0
    executor_tick_seconds: float = 1.0
    executor_worker: Literal["fake", "llm"] = "fake"
    executor_progress_seconds: float = 1.0

    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.8:27b"
    ollama_num_ctx: int = 16384
    ollama_think: bool = True
    ollama_temperature: float = 0.3
    llm_concurrency: int = 1
    llm_stage_timeout_seconds: float = 300.0
    llm_retries: int = 1
    llm_reserve_tokens: int = 6144


@lru_cache
def get_settings() -> Settings:
    return Settings()
