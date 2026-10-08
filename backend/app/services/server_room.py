"""What the server room panel shows: the model server, the GPU, web search, who uses the model, token usage.

Usage numbers come from the runs table (fake runs excluded); live probes (Ollama, nvidia-smi, SearXNG) are
short and never fail the request: a probe that does not answer is reported as down / unknown.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import httpx
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Agent, Run, Task
from app.models.enums import RunProvider, RunStatus
from app.jobs.sources import STATES
from app.schemas.server_room import (
    GpuInfo,
    JobSourceInfo,
    LastSpeed,
    LoadedModel,
    ModelUser,
    OllamaInfo,
    ServerRoom,
    TokenRow,
    TokenTotals,
)
from app.services.state import start_of_local_day
from app.web import SearxClient

PROBE_TIMEOUT = 2.0


class Probes(Protocol):
    async def ollama(self) -> OllamaInfo: ...
    async def gpu(self) -> GpuInfo | None: ...
    async def searxng(self) -> bool: ...


@dataclass
class LiveProbes:
    settings: Settings

    async def ollama(self) -> OllamaInfo:
        url = self.settings.ollama_url
        try:
            async with httpx.AsyncClient(base_url=url, timeout=PROBE_TIMEOUT, trust_env=False) as client:
                version = (await client.get("/api/version")).json().get("version")
                running = (await client.get("/api/ps")).json().get("models", [])
        except (httpx.HTTPError, ValueError):
            return OllamaInfo(up=False, url=url)
        models = [
            LoadedModel(
                name=m.get("name", "?"),
                size_gb=round((m.get("size") or 0) / 1e9, 1),
                vram_gb=round((m.get("size_vram") or 0) / 1e9, 1),
                context_length=m.get("context_length"),
                expires_at=m.get("expires_at"),
            )
            for m in running
        ]
        return OllamaInfo(up=True, url=url, version=version, models=models)

    async def gpu(self) -> GpuInfo | None:
        try:
            proc = await asyncio.create_subprocess_exec(
                "nvidia-smi",
                "--query-gpu=name,memory.used,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), PROBE_TIMEOUT)
            name, used, total, util = [p.strip() for p in out.decode().splitlines()[0].split(",")]
            return GpuInfo(name=name, used_mb=int(used), total_mb=int(total), utilization=int(util))
        except (OSError, TimeoutError, ValueError, IndexError):
            return None

    async def searxng(self) -> bool:
        return await SearxClient(self.settings.searxng_url).healthy()


def job_sources(settings: Settings) -> list[JobSourceInfo]:
    """Whether each job source has its keys, and how its latest request went (no request is made here)."""

    def has(*values: object) -> bool:
        return all(v is not None and v.get_secret_value().strip() for v in values)  # type: ignore[attr-defined]

    rows = [
        ("adzuna", "Adzuna", has(settings.adzuna_app_id, settings.adzuna_app_key)),
        ("reed", "Reed", has(settings.reed_api_key)),
    ]
    infos = []
    for name, label, configured in rows:
        state = STATES.get(name)
        infos.append(
            JobSourceInfo(
                name=name,
                label=label,
                configured=configured,
                last_ok_at=state.ok_at if state else None,
                last_error=state.error if state else None,
                last_error_at=state.error_at if state else None,
            )
        )
    return infos


async def _model_users(session: AsyncSession, status: RunStatus) -> list[ModelUser]:
    rows = (
        await session.execute(
            select(Run, Task.title, Agent)
            .join(Task, Run.task_id == Task.id)
            .join(Agent, Task.agent_id == Agent.id)
            .where(Run.status == status, Run.provider != RunProvider.FAKE)
            .order_by(Run.started_at)
        )
    ).all()
    return [
        ModelUser(agent_id=a.id, name=a.name, title=a.title, task_title=title, stage=r.stage, since=r.started_at)
        for r, title, a in rows
    ]


async def build_server_room(session: AsyncSession, settings: Settings, probes: Probes, now: datetime | None = None) -> ServerRoom:
    ollama, gpu, searxng_up = await asyncio.gather(probes.ollama(), probes.gpu(), probes.searxng())

    last = (
        await session.execute(
            select(Run, Agent.title)
            .join(Task, Run.task_id == Task.id)
            .join(Agent, Task.agent_id == Agent.id)
            .where(Run.provider != RunProvider.FAKE, Run.tokens_per_second.is_not(None))
            .order_by(Run.finished_at.desc().nulls_last(), Run.id.desc())
            .limit(1)
        )
    ).first()

    midnight = start_of_local_day(now or datetime.now().astimezone())
    today = Run.started_at >= midnight
    usage = (
        await session.execute(
            select(
                Agent.id,
                Agent.name,
                Agent.title,
                func.coalesce(func.sum(case((today, Run.input_tokens), else_=0)), 0),
                func.coalesce(func.sum(case((today, Run.output_tokens), else_=0)), 0),
                func.coalesce(func.sum(Run.input_tokens), 0),
                func.coalesce(func.sum(Run.output_tokens), 0),
            )
            .join(Task, Run.task_id == Task.id)
            .join(Agent, Task.agent_id == Agent.id)
            .where(Run.provider != RunProvider.FAKE)
            .group_by(Agent.id, Agent.name, Agent.title)
            .having(func.sum(Run.input_tokens + Run.output_tokens) > 0)
            .order_by(func.sum(Run.input_tokens + Run.output_tokens).desc())
        )
    ).all()
    rows = [
        TokenRow(agent_id=i, name=n, title=t, today_in=a, today_out=b, total_in=c, total_out=d)
        for i, n, t, a, b, c, d in usage
    ]
    return ServerRoom(
        worker=settings.executor_worker,
        default_model=settings.ollama_model,
        ollama=ollama,
        gpu=gpu,
        searxng_up=searxng_up,
        searxng_url=settings.searxng_url,
        job_sources=job_sources(settings),
        last_speed=(
            LastSpeed(
                tokens_per_second=last[0].tokens_per_second,
                model=last[0].model,
                agent_title=last[1],
                finished_at=last[0].finished_at,
            )
            if last
            else None
        ),
        queue=await _model_users(session, RunStatus.WAITING),
        running=await _model_users(session, RunStatus.RUNNING),
        tokens=rows,
        totals=TokenTotals(
            today_in=sum(r.today_in for r in rows),
            today_out=sum(r.today_out for r in rows),
            total_in=sum(r.total_in for r in rows),
            total_out=sum(r.total_out for r in rows),
        ),
    )
