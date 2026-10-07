"""What the HUD model indicator shows: which worker runs, whether Ollama answers, whether the model is there."""

import httpx

from app.core.config import Settings
from app.schemas.llm import LlmStatus

TIMEOUT_SECONDS = 2.0


def same_model(a: str, b: str) -> bool:
    """Ollama names without a tag mean `:latest`."""
    norm = lambda name: name if ":" in name else f"{name}:latest"  # noqa: E731
    return norm(a) == norm(b)


async def llm_status(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> LlmStatus:
    if settings.executor_worker != "llm":
        return LlmStatus(worker=settings.executor_worker, ok=True, model=None, message="Фальшивый исполнитель: модель не используется")
    model = settings.ollama_model
    try:
        async with httpx.AsyncClient(base_url=settings.ollama_url, timeout=TIMEOUT_SECONDS, transport=transport) as client:
            version = (await client.get("/api/version")).json().get("version")
            tags = (await client.get("/api/tags")).json().get("models", [])
            running = (await client.get("/api/ps")).json().get("models", [])
    except (httpx.HTTPError, ValueError):
        return LlmStatus(
            worker="llm",
            ok=False,
            model=model,
            ollama=False,
            message=f"Ollama не отвечает по адресу {settings.ollama_url}",
        )
    available = any(same_model(m.get("name", ""), model) for m in tags)
    loaded = any(same_model(m.get("name", ""), model) for m in running)
    return LlmStatus(
        worker="llm",
        ok=available,
        model=model,
        ollama=True,
        version=version,
        available=available,
        loaded=loaded,
        message=None if available else f"Модель «{model}» не скачана: ollama pull {model}",
    )
