from functools import lru_cache

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
