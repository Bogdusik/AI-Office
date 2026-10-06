from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Floor
from app.schemas.floor import FloorCreate, FloorUpdate
from app.services import rules
from app.services.errors import ConflictError, NotFoundError


async def list_floors(session: AsyncSession) -> Sequence[Floor]:
    result = await session.scalars(select(Floor).order_by(Floor.number))
    return result.all()


async def get_floor(session: AsyncSession, floor_id: int, *, lock: bool = False) -> Floor:
    stmt = select(Floor).where(Floor.id == floor_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    floor = await session.scalar(stmt)
    if floor is None:
        raise NotFoundError(f"Floor {floor_id} not found")
    return floor


async def count_active_agents(session: AsyncSession, floor_id: int) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(Agent)
        .where(Agent.floor_id == floor_id, Agent.archived_at.is_(None))
    )
    return count or 0


async def _ensure_number_free(
    session: AsyncSession, number: int, exclude_id: int | None = None
) -> None:
    stmt = select(Floor.id).where(Floor.number == number)
    if exclude_id is not None:
        stmt = stmt.where(Floor.id != exclude_id)
    if await session.scalar(stmt) is not None:
        raise ConflictError(f"Floor number {number} is already taken")


async def create_floor(session: AsyncSession, data: FloorCreate) -> Floor:
    await _ensure_number_free(session, data.number)
    floor = Floor(**data.model_dump())
    session.add(floor)
    await session.commit()
    await session.refresh(floor)
    return floor


async def update_floor(session: AsyncSession, floor_id: int, data: FloorUpdate) -> Floor:
    floor = await get_floor(session, floor_id, lock=True)
    changes = data.changes()
    if "number" in changes and changes["number"] != floor.number:
        await _ensure_number_free(session, changes["number"], exclude_id=floor.id)
    if "capacity" in changes:
        active = await count_active_agents(session, floor.id)
        rules.ensure_capacity_fits(active, changes["capacity"])
        max_desk = await session.scalar(
            select(func.max(Agent.desk_index)).where(Agent.floor_id == floor.id)
        )
        if max_desk is not None:
            rules.ensure_desk_in_range(max_desk, changes["capacity"])
    for field, value in changes.items():
        setattr(floor, field, value)
    await session.commit()
    await session.refresh(floor)
    return floor


async def delete_floor(session: AsyncSession, floor_id: int) -> None:
    floor = await get_floor(session, floor_id, lock=True)
    rules.ensure_floor_empty(await count_active_agents(session, floor.id))
    await session.delete(floor)
    await session.commit()
