from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.agent import AgentCreate, AgentRead, AgentUpdate
from app.services import agents as service

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentRead], status_code=status.HTTP_200_OK)
async def list_agents(
    floor_id: int | None = None,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
) -> list[AgentRead]:
    agents = await service.list_agents(db, floor_id=floor_id, include_archived=include_archived)
    return [AgentRead.model_validate(a) for a in agents]


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)) -> AgentRead:
    return AgentRead.model_validate(await service.create_agent(db, data))


@router.get("/{agent_id}", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def read_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> AgentRead:
    return AgentRead.model_validate(await service.get_agent(db, agent_id))


@router.patch("/{agent_id}", response_model=AgentRead, status_code=status.HTTP_200_OK)
async def update_agent(
    agent_id: int, data: AgentUpdate, db: AsyncSession = Depends(get_db)
) -> AgentRead:
    return AgentRead.model_validate(await service.update_agent(db, agent_id, data))


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await service.archive_agent(db, agent_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
