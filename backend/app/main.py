import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.executor import Executor, FakeWorker, LlmSettings, LlmWorker, StageWorker, Timings
from app.executor.job_tools import JobTools
from app.executor.research import WebTools
from app.jobs import AdzunaSource, JobSearch, ReedSource
from app.web import FetchLimits, PageFetcher, SearxClient
from app.services.errors import (
    ConflictError,
    DomainError,
    NotFoundError,
    ValidationFailedError,
)

# httpx logs every request URL at INFO; the Adzuna API takes its key in the URL, so those lines must never appear.
logging.getLogger("httpx").setLevel(logging.WARNING)

ERROR_STATUS: dict[type[DomainError], int] = {
    NotFoundError: status.HTTP_404_NOT_FOUND,
    ConflictError: status.HTTP_409_CONFLICT,
    ValidationFailedError: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def build_worker() -> StageWorker:
    settings = get_settings()
    if settings.executor_worker == "fake":
        return FakeWorker(settings.executor_stage_seconds)
    web = WebTools(
        search=SearxClient(settings.searxng_url, settings.web_tool_timeout_seconds, settings.web_search_results),
        fetcher=PageFetcher(
            FetchLimits(
                timeout=settings.web_tool_timeout_seconds,
                max_bytes=settings.web_max_bytes,
                page_chars=settings.web_page_chars,
            )
        ),
        max_calls=settings.web_max_tool_calls,
        max_pages=settings.web_max_pages,
        tool_timeout=settings.web_tool_timeout_seconds,
        stage_timeout=settings.llm_research_timeout_seconds,
    )
    fetcher = web.fetcher
    jobs = JobTools(
        search=JobSearch(
            [
                AdzunaSource(settings.adzuna_app_id, settings.adzuna_app_key, settings.jobs_timeout_seconds, fetcher),
                ReedSource(settings.reed_api_key, settings.jobs_timeout_seconds),
            ],
            cache_seconds=settings.jobs_cache_seconds,
        ),
        max_calls=settings.jobs_max_calls,
        tool_timeout=settings.jobs_timeout_seconds * 2,
        max_results=settings.jobs_max_results,
        stage_timeout=settings.llm_research_timeout_seconds,
    )
    return LlmWorker(
        LlmSettings(
            url=settings.ollama_url,
            model=settings.ollama_model,
            num_ctx=settings.ollama_num_ctx,
            think=settings.ollama_think,
            temperature=settings.ollama_temperature,
            concurrency=settings.llm_concurrency,
            stage_timeout=settings.llm_stage_timeout_seconds,
            retries=settings.llm_retries,
            reserve_tokens=settings.llm_reserve_tokens,
            think_tokens=settings.llm_think_tokens,
        ),
        web=web,
        jobs=jobs,
    )


def build_executor() -> Executor:
    settings = get_settings()
    return Executor(
        SessionLocal,
        engine,
        build_worker(),
        Timings(
            arrive=settings.executor_arrive_seconds,
            depart=settings.executor_depart_seconds,
            tick=settings.executor_tick_seconds,
            progress=settings.executor_progress_seconds,
        ),
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    executor = build_executor() if get_settings().executor_enabled else None
    if executor:
        await executor.start()
    try:
        yield
    finally:
        if executor:
            await executor.stop()
        await engine.dispose()


app = FastAPI(title="AI Office API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    code = next(
        (c for cls, c in ERROR_STATUS.items() if isinstance(exc, cls)),
        status.HTTP_400_BAD_REQUEST,
    )
    return JSONResponse(status_code=code, content={"detail": exc.detail})


app.include_router(health_router)
app.include_router(api_router)
