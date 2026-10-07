from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Run
from app.models.enums import RunProvider, RunStatus, TaskStage
from app.schemas.server_room import GpuInfo, LoadedModel, OllamaInfo
from app.services import tasks as task_service
from app.services.server_room import build_server_room
from tests.conftest import Factory


@dataclass
class StubProbes:
    up: bool = True

    async def ollama(self) -> OllamaInfo:
        if not self.up:
            return OllamaInfo(up=False, url="http://ollama.test")
        model = LoadedModel(name="qwen3.8:27b", size_gb=17.3, vram_gb=17.3, context_length=16384, expires_at=None)
        return OllamaInfo(up=True, url="http://ollama.test", version="0.35.1", models=[model])

    async def gpu(self) -> GpuInfo | None:
        return GpuInfo(name="RTX 4090", used_mb=19000, total_mb=24564, utilization=97) if self.up else None

    async def searxng(self) -> bool:
        return self.up


def settings() -> Settings:
    return Settings(database_url="postgresql+asyncpg://x/y", executor_worker="llm")


def run(task_id: int, provider: RunProvider, status: RunStatus, started: datetime, tokens: tuple[int, int], **extra: Any) -> Run:
    return Run(
        task_id=task_id,
        stage=TaskStage.DRAFT,
        provider=provider,
        status=status,
        started_at=started,
        input_tokens=tokens[0],
        output_tokens=tokens[1],
        **extra,
    )


async def test_server_room_counts_real_tokens_and_model_users(
    db: AsyncSession, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    writer = await make_agent(floor["id"], name="Harper", title="Writer")
    coach = await make_agent(floor["id"], name="Riley", title="Coach")
    t1 = await make_task(writer["id"], title="Article")
    t2 = await make_task(coach["id"], title="STAR")
    await task_service.start(db, t1["id"])
    await task_service.start(db, t2["id"])

    now = datetime.now().astimezone()
    yesterday = now - timedelta(days=1)
    db.add_all(
        [
            run(t1["id"], RunProvider.OLLAMA, RunStatus.SUCCEEDED, yesterday, (1000, 200), tokens_per_second=88.0, finished_at=yesterday, model="qwen3.8:27b"),
            run(t1["id"], RunProvider.OLLAMA, RunStatus.SUCCEEDED, now, (300, 50), tokens_per_second=101.5, finished_at=now, model="qwen3.8:27b"),
            run(t1["id"], RunProvider.FAKE, RunStatus.SUCCEEDED, now, (9999, 9999)),
            run(t1["id"], RunProvider.OLLAMA, RunStatus.RUNNING, now, (0, 0)),
            run(t2["id"], RunProvider.OLLAMA, RunStatus.WAITING, now + timedelta(seconds=1), (0, 0)),
        ]
    )
    await db.commit()

    room = await build_server_room(db, settings(), StubProbes(), now)

    assert room.ollama.up and room.ollama.models[0].vram_gb == 17.3
    assert room.gpu is not None and room.gpu.used_mb == 19000
    assert room.searxng_up
    assert room.last_speed is not None and room.last_speed.tokens_per_second == 101.5
    assert room.last_speed.agent_title == "Writer"
    assert [(u.name, u.task_title) for u in room.running] == [("Harper", "Article")]
    assert [(u.name, u.task_title) for u in room.queue] == [("Riley", "STAR")]
    [row] = room.tokens
    assert (row.name, row.today_in, row.today_out, row.total_in, row.total_out) == ("Harper", 300, 50, 1300, 250)
    assert room.totals.total_in == 1300 and room.totals.today_out == 50


async def test_server_room_reports_services_down(db: AsyncSession) -> None:
    room = await build_server_room(db, settings(), StubProbes(up=False), datetime.now(UTC))
    assert not room.ollama.up and room.gpu is None and not room.searxng_up
    assert room.tokens == [] and room.last_speed is None and room.running == [] and room.queue == []
