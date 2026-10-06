from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.profile import ProfileRead, ProfileUpdate
from app.services import profile as service

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=ProfileRead, status_code=status.HTTP_200_OK)
async def read_profile(db: AsyncSession = Depends(get_db)) -> ProfileRead:
    return ProfileRead.model_validate(await service.get_or_create_profile(db))


@router.put("", response_model=ProfileRead, status_code=status.HTTP_200_OK)
async def replace_profile(data: ProfileUpdate, db: AsyncSession = Depends(get_db)) -> ProfileRead:
    return ProfileRead.model_validate(await service.update_profile(db, data))
