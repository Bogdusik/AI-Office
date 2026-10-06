from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.floor import FloorCreate, FloorRead, FloorUpdate
from app.services import floors as service

router = APIRouter(prefix="/floors", tags=["floors"])


@router.get("", response_model=list[FloorRead], status_code=status.HTTP_200_OK)
async def list_floors(db: AsyncSession = Depends(get_db)) -> list[FloorRead]:
    return [FloorRead.model_validate(f) for f in await service.list_floors(db)]


@router.post("", response_model=FloorRead, status_code=status.HTTP_201_CREATED)
async def create_floor(data: FloorCreate, db: AsyncSession = Depends(get_db)) -> FloorRead:
    return FloorRead.model_validate(await service.create_floor(db, data))


@router.get("/{floor_id}", response_model=FloorRead, status_code=status.HTTP_200_OK)
async def read_floor(floor_id: int, db: AsyncSession = Depends(get_db)) -> FloorRead:
    return FloorRead.model_validate(await service.get_floor(db, floor_id))


@router.patch("/{floor_id}", response_model=FloorRead, status_code=status.HTTP_200_OK)
async def update_floor(
    floor_id: int, data: FloorUpdate, db: AsyncSession = Depends(get_db)
) -> FloorRead:
    return FloorRead.model_validate(await service.update_floor(db, floor_id, data))


@router.delete("/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_floor(floor_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    await service.delete_floor(db, floor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
