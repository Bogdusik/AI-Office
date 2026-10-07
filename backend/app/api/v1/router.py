from fastapi import APIRouter

from app.api.v1 import agents, events, floors, llm, profile, server_room, state, tasks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(profile.router)
api_router.include_router(floors.router)
api_router.include_router(agents.router)
api_router.include_router(tasks.router)
api_router.include_router(state.router)
api_router.include_router(events.router)
api_router.include_router(llm.router)
api_router.include_router(server_room.router)
