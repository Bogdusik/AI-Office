from fastapi import APIRouter, status

from app.core.config import get_settings
from app.schemas.llm import LlmStatus
from app.services.llm_status import llm_status

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/status", response_model=LlmStatus, status_code=status.HTTP_200_OK)
async def read_llm_status() -> LlmStatus:
    return await llm_status(get_settings())
