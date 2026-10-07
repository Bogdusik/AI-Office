"""In-process event bus: services and the executor publish, SSE clients and the executor subscribe."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

QUEUE_SIZE = 1000


@dataclass(frozen=True)
class Event:
    type: str
    data: dict[str, Any] = field(default_factory=dict)


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()

    def publish(self, type_: str, **data: Any) -> None:
        event = Event(type_, data)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A stalled subscriber loses events; clients re-read /state on reconnect anyway.
                pass

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[Event]]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)


bus = EventBus()


def publish_task(task: Any) -> None:
    bus.publish(
        "task",
        id=task.id,
        agent_id=task.agent_id,
        title=task.title,
        status=str(task.status),
        stage=str(task.stage) if task.stage else None,
    )


def publish_agent(agent_id: int, status: Any) -> None:
    bus.publish("agent", id=agent_id, status=str(status))


def publish_run(task_id: int, agent_id: int, run_id: int, status: Any) -> None:
    """A stage run changed state (e.g. queued for the model → running)."""
    bus.publish("run", task_id=task_id, agent_id=agent_id, run_id=run_id, status=str(status))


def publish_progress(task_id: int, agent_id: int, run_id: int) -> None:
    """New partial text was saved on a running stage; only open task cards need to refetch."""
    bus.publish("progress", task_id=task_id, agent_id=agent_id, run_id=run_id)


def publish_artifact(task_id: int, agent_id: int, version: int) -> None:
    bus.publish("artifact", task_id=task_id, agent_id=agent_id, version=version)
