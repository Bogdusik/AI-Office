from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PROFILE_ID, Agent, Floor, Profile
from app.seed.data import AGENTS, FLOORS


@dataclass
class SeedReport:
    created: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


async def run_seed(session: AsyncSession) -> SeedReport:
    report = SeedReport()

    if await session.get(Profile, PROFILE_ID) is None:
        session.add(Profile(id=PROFILE_ID))
        report.created.append("profile")
    else:
        report.skipped.append("profile")

    floors: dict[int, Floor] = {}
    for spec in FLOORS:
        floor = await session.scalar(select(Floor).where(Floor.number == spec.number))
        if floor is None:
            floor = Floor(
                number=spec.number,
                name=spec.name,
                capacity=spec.capacity,
                has_director_office=spec.has_director_office,
            )
            session.add(floor)
            await session.flush()
            report.created.append(f"floor {spec.number}")
        else:
            report.skipped.append(f"floor {spec.number}")
        floors[spec.number] = floor

    for agent_spec in AGENTS:
        exists = await session.scalar(
            select(Agent.id).where(Agent.role_key == agent_spec.role_key).limit(1)
        )
        if exists is not None:
            report.skipped.append(f"agent {agent_spec.role_key}")
            continue
        session.add(
            Agent(
                floor_id=floors[agent_spec.floor_number].id,
                desk_index=agent_spec.desk_index,
                role_key=agent_spec.role_key,
                name=agent_spec.name,
                title=agent_spec.title,
                system_prompt=agent_spec.system_prompt,
                web_access=agent_spec.web_access,
            )
        )
        report.created.append(f"agent {agent_spec.role_key}")

    await session.commit()
    return report
