import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse

from app.events import Event, bus

router = APIRouter(prefix="/events", tags=["events"])

HEARTBEAT_SECONDS = 15.0
RETRY_MS = 2000


def format_event(event: Event) -> str:
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


async def event_stream(
    queue: asyncio.Queue[Event],
    disconnected: Callable[[], Awaitable[bool]],
    heartbeat: float = HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """SSE frames for one client; a comment line keeps idle connections (and proxies) alive."""
    yield f"retry: {RETRY_MS}\n\n"
    while not await disconnected():
        try:
            event = await asyncio.wait_for(queue.get(), heartbeat)
        except TimeoutError:
            yield ": ping\n\n"
            continue
        yield format_event(event)


@router.get("", status_code=status.HTTP_200_OK, response_class=StreamingResponse)
async def stream_events(request: Request) -> StreamingResponse:
    """Server-sent events: `agent` (status), `task` (status/stage), `artifact` (new result version)."""

    async def frames() -> AsyncIterator[str]:
        async with bus.subscribe() as queue:
            async for frame in event_stream(queue, request.is_disconnected):
                yield frame

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
