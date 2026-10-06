from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.state import WorldState
from app.services.state import build_state

router = APIRouter(prefix="/state", tags=["state"])


@router.get("", response_model=WorldState, status_code=status.HTTP_200_OK)
async def read_state(db: AsyncSession = Depends(get_db)) -> WorldState:
    return await build_state(db)
