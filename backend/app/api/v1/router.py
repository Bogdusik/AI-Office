from fastapi import APIRouter

from app.api.v1 import agents, floors, profile, state, tasks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(profile.router)
api_router.include_router(floors.router)
api_router.include_router(agents.router)
api_router.include_router(tasks.router)
api_router.include_router(state.router)
