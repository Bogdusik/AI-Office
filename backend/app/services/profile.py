from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PROFILE_ID, Profile
from app.schemas.profile import ProfileUpdate


async def get_or_create_profile(session: AsyncSession) -> Profile:
    profile = await session.get(Profile, PROFILE_ID)
    if profile is None:
        profile = Profile(id=PROFILE_ID)
        session.add(profile)
        await session.commit()
        await session.refresh(profile)
    return profile


async def update_profile(session: AsyncSession, data: ProfileUpdate) -> Profile:
    profile = await get_or_create_profile(session)
    for field, value in data.model_dump().items():
        setattr(profile, field, value)
    await session.commit()
    await session.refresh(profile)
    return profile
