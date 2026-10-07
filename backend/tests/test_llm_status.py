import httpx

from app.core.config import Settings
from app.services.llm_status import llm_status


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"database_url": "postgresql+asyncpg://x/y", "executor_worker": "llm", "ollama_model": "qwen3.8:27b"}
    return Settings(**{**values, **overrides})


def ollama(tags: list[str], running: list[str]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        match request.url.path:
            case "/api/version":
                return httpx.Response(200, json={"version": "0.35.1"})
            case "/api/tags":
                return httpx.Response(200, json={"models": [{"name": n} for n in tags]})
            case "/api/ps":
                return httpx.Response(200, json={"models": [{"name": n} for n in running]})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_fake_worker_needs_no_model() -> None:
    status = await llm_status(settings(executor_worker="fake"))
    assert (status.worker, status.ok, status.model) == ("fake", True, None)


async def test_model_available_and_loaded() -> None:
    status = await llm_status(settings(), ollama(["qwen3.8:27b"], ["qwen3.8:27b"]))
    assert status.ok and status.ollama and status.available and status.loaded
    assert status.version == "0.35.1" and status.message is None


async def test_model_missing() -> None:
    status = await llm_status(settings(), ollama(["other:7b"], []))
    assert not status.ok and status.ollama and status.available is False
    assert status.message == "Модель «qwen3.8:27b» не скачана: ollama pull qwen3.8:27b"


async def test_untagged_name_means_latest() -> None:
    status = await llm_status(settings(ollama_model="phi"), ollama(["phi:latest"], []))
    assert status.ok and status.loaded is False


async def test_ollama_down() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    status = await llm_status(settings(ollama_url="http://localhost:1"), httpx.MockTransport(refuse))
    assert not status.ok and status.ollama is False
    assert status.message == "Ollama не отвечает по адресу http://localhost:1"
