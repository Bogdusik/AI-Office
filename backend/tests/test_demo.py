from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PROFILE_ID, Agent, Artifact, Floor, Profile, Run, Task, TaskComment
from app.models.enums import AgentStatus, RunProvider, TaskStatus
from app.seed.demo import PROFILE, TASKS, DemoRefused, run_demo


async def _count(db: AsyncSession, model: type) -> int:
    return await db.scalar(select(func.count()).select_from(model)) or 0


async def test_demo_fills_an_empty_database(client: AsyncClient, db: AsyncSession) -> None:
    await run_demo(db)

    profile = await db.get_one(Profile, PROFILE_ID)
    assert profile.name == PROFILE["name"]
    tasks = (await db.scalars(select(Task).order_by(Task.id))).all()
    assert [t.title for t in tasks] == [t.title for t in TASKS]
    assert {t.status for t in tasks} == {TaskStatus.DONE, TaskStatus.NEEDS_REVIEW, TaskStatus.QUEUED}

    runs = (await db.scalars(select(Run))).all()
    assert runs and all(r.provider == RunProvider.FAKE and r.input_tokens == r.output_tokens == 0 for r in runs)
    versions = sum(len(t.versions) for t in TASKS)
    assert await _count(db, Artifact) == versions
    assert await _count(db, TaskComment) == sum(1 for t in TASKS for v in t.versions if v.comment)

    review = next(t for t in tasks if t.status == TaskStatus.NEEDS_REVIEW)
    assert (await db.get_one(Agent, review.agent_id)).status == AgentStatus.WAITING_REVIEW
    for task in tasks:
        if task.status == TaskStatus.QUEUED:
            assert task.started_at is None and task.stage is None

    assert (await client.get("/api/v1/state")).status_code == 200
    assert (await client.get("/api/v1/profile")).json()["name"] == PROFILE["name"]


async def test_demo_refuses_a_filled_profile(db: AsyncSession) -> None:
    db.add(Profile(id=PROFILE_ID, goal="My real goal"))
    await db.commit()

    try:
        await run_demo(db)
    except DemoRefused:
        pass
    else:
        raise AssertionError("demo seed ran over a filled profile")
    assert (await _count(db, Floor), await _count(db, Task)) == (0, 0)
    assert (await db.get_one(Profile, PROFILE_ID)).goal == "My real goal"


async def test_demo_refuses_existing_tasks(db: AsyncSession) -> None:
    await run_demo(db)
    tasks = await _count(db, Task)
    profile = await db.get_one(Profile, PROFILE_ID)
    profile.name = profile.summary = profile.goal = profile.constraints = profile.notes = ""
    await db.commit()

    try:
        await run_demo(db)
    except DemoRefused:
        pass
    else:
        raise AssertionError("demo seed ran over existing tasks")
    assert await _count(db, Task) == tasks
