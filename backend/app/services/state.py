from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Floor, Task
from app.models.enums import TaskStatus
from app.schemas.state import AgentState, CurrentTask, FloorState, WorldState
from app.services import rules


async def build_state(session: AsyncSession) -> WorldState:
    floors = (await session.scalars(select(Floor).order_by(Floor.number))).all()
    agents = (
        await session.scalars(
            select(Agent).where(Agent.archived_at.is_(None)).order_by(Agent.desk_index)
        )
    ).all()
    tasks = (
        await session.scalars(
            select(Task).where(
                Task.agent_id.in_([a.id for a in agents]),
                Task.status.in_(rules.ACTIVE_STATUSES),
            )
        )
    ).all()

    tasks_by_agent: dict[int, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_agent[task.agent_id].append(task)

    agents_by_floor: dict[int, list[AgentState]] = defaultdict(list)
    for agent in agents:
        assert agent.floor_id is not None and agent.desk_index is not None
        own = tasks_by_agent[agent.id]
        current = rules.pick_current_task(own)
        agents_by_floor[agent.floor_id].append(
            AgentState(
                id=agent.id,
                name=agent.name,
                role_key=agent.role_key,
                title=agent.title,
                desk_index=agent.desk_index,
                status=agent.status,
                web_access=agent.web_access,
                current_task=(
                    CurrentTask(
                        id=current.id, title=current.title, status=current.status, stage=current.stage
                    )
                    if current
                    else None
                ),
                queue_length=sum(t.status == TaskStatus.QUEUED for t in own),
                awaiting_review=sum(t.status == TaskStatus.NEEDS_REVIEW for t in own),
            )
        )

    return WorldState(
        floors=[
            FloorState(
                id=f.id,
                number=f.number,
                name=f.name,
                kind=f.kind,
                capacity=f.capacity,
                has_director_office=f.has_director_office,
                agents=agents_by_floor[f.id],
            )
            for f in floors
        ]
    )
