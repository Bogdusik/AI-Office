from fastapi import APIRouter, status
from pydantic import BaseModel

from app.db.session import ping_db

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    db: bool


@router.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", db=await ping_db())
