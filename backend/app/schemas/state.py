from pydantic import BaseModel

from app.models.enums import AgentStatus, FloorKind, TaskStage, TaskStatus


class CurrentTask(BaseModel):
    id: int
    title: str
    status: TaskStatus
    stage: TaskStage | None
    waiting_for_model: bool = False
    on_web: bool = False
    """A web search or page read is in progress in the running stage."""


class AgentState(BaseModel):
    id: int
    name: str
    role_key: str
    title: str
    desk_index: int
    status: AgentStatus
    web_access: bool
    current_task: CurrentTask | None
    queue_length: int
    awaiting_review: int


class FloorState(BaseModel):
    id: int
    number: int
    name: str
    kind: FloorKind
    capacity: int
    has_director_office: bool
    has_server_room: bool
    has_kitchen: bool
    agents: list[AgentState]


class WorldStats(BaseModel):
    tasks_in_progress: int
    awaiting_review: int
    done_today: int
    model_busy: bool = False
    """A model request is running right now (real model only, not the fake worker)."""
    model_queue: int = 0
    """Stage runs waiting for the model."""


class WorldState(BaseModel):
    floors: list[FloorState]
    stats: WorldStats
