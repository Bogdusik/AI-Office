from pydantic import BaseModel

from app.models.enums import AgentStatus, FloorKind, TaskStage, TaskStatus


class CurrentTask(BaseModel):
    id: int
    title: str
    status: TaskStatus
    stage: TaskStage | None


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
    agents: list[AgentState]


class WorldState(BaseModel):
    floors: list[FloorState]
