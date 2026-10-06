import asyncio
import json
from typing import Any

from httpx import AsyncClient

from app.api.v1.events import event_stream, format_event
from app.events import Event, EventBus, bus
from app.main import app
from tests.conftest import Factory


async def test_bus_delivers_to_every_subscriber_until_unsubscribed() -> None:
    local = EventBus()
    async with local.subscribe() as a, local.subscribe() as b:
        local.publish("task", id=1)
        assert (await a.get(), await b.get()) == (Event("task", {"id": 1}),) * 2
    local.publish("task", id=2)
    assert a.empty() and b.empty()


def test_sse_frame_format() -> None:
    frame = format_event(Event("agent", {"id": 3, "status": "working", "name": "Ада"}))
    assert frame.startswith("event: agent\ndata: ")
    assert frame.endswith("\n\n")
    assert json.loads(frame.split("data: ", 1)[1]) == {"id": 3, "status": "working", "name": "Ада"}


async def test_stream_sends_retry_events_and_heartbeats() -> None:
    queue: asyncio.Queue[Event] = asyncio.Queue()
    closed = False

    async def disconnected() -> bool:
        return closed

    stream = event_stream(queue, disconnected, heartbeat=0.05)
    assert (await anext(stream)).startswith("retry:")
    assert await anext(stream) == ": ping\n\n"
    await queue.put(Event("task", {"id": 7}))
    assert await anext(stream) == 'event: task\ndata: {"id": 7}\n\n'
    closed = True
    assert [frame async for frame in stream] == []


def test_events_route_is_registered() -> None:
    assert "/api/v1/events" in app.openapi()["paths"]


async def test_api_actions_publish_events(
    client: AsyncClient, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    async with bus.subscribe() as queue:
        task = await make_task(agent["id"], title="Отчёт")
        await client.post(f"/api/v1/tasks/{task['id']}/cancel")
        await client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "не публикуется"})
        await client.delete(f"/api/v1/agents/{agent['id']}")
        seen: list[tuple[str, dict[str, Any]]] = []
        while not queue.empty():
            e = queue.get_nowait()
            seen.append((e.type, e.data))

    assert seen == [
        ("task", {"id": task["id"], "agent_id": agent["id"], "title": "Отчёт", "status": "queued", "stage": None}),
        ("task", {"id": task["id"], "agent_id": agent["id"], "title": "Отчёт", "status": "cancelled", "stage": None}),
        ("agent", {"id": agent["id"], "status": "off_site"}),
    ]
