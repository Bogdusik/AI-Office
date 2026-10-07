from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.server_room import ServerRoom
from app.services.server_room import LiveProbes, build_server_room

router = APIRouter(prefix="/server-room", tags=["server-room"])


@router.get("", response_model=ServerRoom, status_code=status.HTTP_200_OK)
async def read_server_room(db: AsyncSession = Depends(get_db)) -> ServerRoom:
    settings = get_settings()
    return await build_server_room(db, settings, LiveProbes(settings))
