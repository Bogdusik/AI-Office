from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ActivityKind, AgentStatus, FloorKind, RunStatus, TaskStage, TaskStatus, TripKind


class WebStep(BaseModel):
    """The web step running right now: a search (target = query) or a page being read (target = site)."""

    kind: str
    target: str


class CurrentTask(BaseModel):
    id: int
    title: str
    status: TaskStatus
    stage: TaskStage | None
    waiting_for_model: bool = False
    on_web: bool = False
    """A web search or page read is in progress in the running stage."""
    run_state: RunStatus | None = None
    """`waiting` (queued for the model) or `running`; None between stages."""
    web_step: WebStep | None = None


class Trip(BaseModel):
    """An agent's latest trip; it lasts `Motion.arrive_seconds` or `Motion.depart_seconds` from `started_at`."""

    kind: TripKind
    started_at: datetime


class Activity(BaseModel):
    kind: ActivityKind
    since: datetime


class AgentState(BaseModel):
    id: int
    name: str
    role_key: str
    title: str
    desk_index: int
    status: AgentStatus
    status_since: datetime
    trip: Trip | None = None
    activity_log: list[Activity] = []
    """Latest activities, oldest first (the scene replays where the agent has been lately)."""
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


class Motion(BaseModel):
    """What the scene needs to animate trips: their lengths and the server clock."""

    arrive_seconds: float
    depart_seconds: float
    server_time: datetime


class WorldState(BaseModel):
    floors: list[FloorState]
    stats: WorldStats
    motion: Motion
