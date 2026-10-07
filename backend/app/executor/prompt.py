"""Builds the chat request for one stage: a system message (agent prompt, director profile, house rules)
and a user message (task, comments, earlier stages, previous result, stage instruction).

Everything is a pure function of `StageInput`, so it is easy to test. When the input does not fit the
context budget, sections are shortened in a fixed order and each cut is marked in the text.
"""

from dataclasses import dataclass, replace

from app.executor.worker import StageInput
from app.models.enums import CommentAuthor, TaskStage

CHARS_PER_TOKEN = 3.5
"""Conservative estimate for English/Russian text; the model's own count is known only after the call."""

MIN_KEEP = 200
"""A section cut below this many characters is dropped entirely (only the marker stays)."""

RULES = """# House rules
- Your output is a draft for the director to review. Never send, publish, submit or apply for anything, and never say you did.
- Do not invent facts: no made-up experience, employers, projects, dates, numbers, names, links or quotes. Use only the director's profile, the task, the director's comments and earlier stage outputs.
- When something you need is missing, write [NEEDS INPUT: what is missing] instead of guessing.
- Write the deliverable in English unless the director asks for another language."""

STAGE_INSTRUCTIONS: dict[TaskStage, str] = {
    TaskStage.PLAN: (
        "Stage: plan. Write a short plan (3-7 bullet points) for producing the deliverable: what it must contain, "
        "which facts from the profile and the task to use, and what information is missing. Do not write the deliverable yet."
    ),
    TaskStage.RESEARCH: (
        "Stage: research. Gather what the deliverable needs: requirements from the task, matching facts from the profile, "
        "key points to cover. You have no web access yet: use only your own knowledge and the material given, do not "
        "include URLs, and end with the line `Sources: not verified (no web access yet).`"
    ),
    TaskStage.DRAFT: (
        "Stage: draft. Write the complete deliverable in Markdown, following the plan and research above. "
        "Use only facts that are given; mark gaps with [NEEDS INPUT: ...]."
    ),
    TaskStage.SELF_CHECK: (
        "Stage: self-check. Check the latest draft against the task, the director's comments and the constraints in the "
        "profile: invented facts, missing requirements, tone, length, language. Fix every problem and return only the "
        "corrected final version in Markdown, with no remarks about the check."
    ),
}

REVISION_NOTE = (
    "This is revision {version}. The director reviewed the previous version and left comments: apply every comment "
    "to the previous version and keep what was not criticised."
)


@dataclass(frozen=True)
class Section:
    title: str
    text: str
    cut_order: int | None = None
    """Lower is shortened first; None is never shortened."""


def truncate(text: str, keep: int) -> str:
    """Keeps the head and the tail and marks what was removed in the middle."""
    removed = len(text) - keep
    if removed <= 0:
        return text
    if keep < MIN_KEEP:
        return f"[... omitted {len(text)} chars ...]"
    head = keep // 2
    return f"{text[:head]}\n[... truncated {removed} chars ...]\n{text[len(text) - (keep - head):]}"


def _profile_text(data: StageInput) -> str:
    p = data.profile
    fields = [("Name", p.name), ("Who I am", p.summary), ("Goal", p.goal), ("Constraints", p.constraints), ("Notes", p.notes)]
    return "\n".join(f"{label}: {value.strip()}" for label, value in fields if value.strip()) or "(empty)"


def sections(data: StageInput) -> tuple[list[Section], list[Section]]:
    """System and user sections in display order, with their cut order (the single place that defines priorities)."""
    system = [
        Section("Your role", data.agent.system_prompt.strip() or f"You are {data.agent.title}."),
        Section("Director profile", _profile_text(data), cut_order=50),
        Section("", RULES),
    ]
    task = f"Title: {data.task.title}\n\n{data.task.description.strip()}".strip()
    user = [Section("Task", task, cut_order=90)]

    comments = [c for c in data.comments if c.author == CommentAuthor.DIRECTOR]
    for i, c in enumerate(comments):
        latest = i == len(comments) - 1
        user.append(Section("Director's comment" + (" (latest)" if latest else ""), c.body.strip(), None if latest else 20 + i))

    earlier = list(data.previous_stages.items())
    for i, (stage, output) in enumerate(earlier):
        latest = i == len(earlier) - 1
        user.append(Section(f"Earlier stage: {stage.value}", output.strip(), 40 if latest else 10 + i))

    if data.previous_results:
        user.append(Section(f"Previous result (version {data.version - 1})", data.previous_results[-1].strip(), cut_order=60))

    instruction = STAGE_INSTRUCTIONS[data.stage]
    if data.version > 1:
        instruction = f"{REVISION_NOTE.format(version=data.version)}\n\n{instruction}"
    user.append(Section("Your stage", instruction))
    return system, user


def _render(parts: list[Section]) -> str:
    return "\n\n".join(f"# {s.title}\n{s.text}" if s.title else s.text for s in parts)


def fit(system: list[Section], user: list[Section], budget_chars: int) -> tuple[list[Section], list[Section]]:
    """Shortens sections in `cut_order` until both messages fit `budget_chars` together."""
    parts = system + user
    excess = len(_render(system)) + len(_render(user)) - budget_chars
    for index in sorted((i for i, s in enumerate(parts) if s.cut_order is not None), key=lambda i: parts[i].cut_order or 0):
        if excess <= 0:
            break
        before = len(parts[index].text)
        parts[index] = replace(parts[index], text=truncate(parts[index].text, max(0, before - excess - 40)))
        excess -= before - len(parts[index].text)
    return parts[: len(system)], parts[len(system) :]


def build_messages(data: StageInput, *, num_ctx: int, reserve_tokens: int) -> list[dict[str, str]]:
    budget = int(max(num_ctx - reserve_tokens, 1024) * CHARS_PER_TOKEN)
    system, user = fit(*sections(data), budget)
    return [{"role": "system", "content": _render(system)}, {"role": "user", "content": _render(user)}]
