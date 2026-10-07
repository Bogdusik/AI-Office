from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.executor import Executor, FakeWorker, Timings
from app.services.errors import (
    ConflictError,
    DomainError,
    NotFoundError,
    ValidationFailedError,
)

ERROR_STATUS: dict[type[DomainError], int] = {
    NotFoundError: status.HTTP_404_NOT_FOUND,
    ConflictError: status.HTTP_409_CONFLICT,
    ValidationFailedError: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def build_executor() -> Executor:
    settings = get_settings()
    return Executor(
        SessionLocal,
        engine,
        FakeWorker(settings.executor_stage_seconds),
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
