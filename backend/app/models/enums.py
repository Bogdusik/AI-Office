from enum import StrEnum


class FloorKind(StrEnum):
    RECEPTION = "reception"
    OFFICE = "office"


class Provider(StrEnum):
    OLLAMA = "ollama"
    ANTHROPIC = "anthropic"


class RunProvider(StrEnum):
    """Who produced a run; `fake` marks the stand-in executor so its tokens never mix with real ones."""

    OLLAMA = "ollama"
    ANTHROPIC = "anthropic"
    FAKE = "fake"


class AgentStatus(StrEnum):
    OFF_SITE = "off_site"
    ARRIVING = "arriving"
    IDLE = "idle"
    WORKING = "working"
    WAITING_REVIEW = "waiting_review"
    LEAVING = "leaving"


class TripKind(StrEnum):
    """An agent's trip between the map edge and their desk."""

    ARRIVE = "arrive"
    DEPART = "depart"


class TaskStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    NEEDS_REVIEW = "needs_review"
    CHANGES_REQUESTED = "changes_requested"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskStage(StrEnum):
    PLAN = "plan"
    RESEARCH = "research"
    DRAFT = "draft"
    SELF_CHECK = "self_check"


class CommentAuthor(StrEnum):
    DIRECTOR = "director"
    AGENT = "agent"


class RunStatus(StrEnum):
    WAITING = "waiting"
    """Queued for the model (GPU); the request has not been sent yet."""
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    CANCELLED = "cancelled"
