from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Floor, Profile
from app.seed.data import AGENTS, COMMON_RULES
from app.seed.runner import run_seed
from app.services import tasks as task_service
from tests.conftest import Factory


async def _count(db: AsyncSession, model: type) -> int:
    return await db.scalar(select(func.count()).select_from(model)) or 0


async def test_seed_is_idempotent(db: AsyncSession) -> None:
    first = await run_seed(db)
    second = await run_seed(db)

    assert len(first.created) == 1 + 3 + 6
    assert second.created == []
    assert (await _count(db, Profile), await _count(db, Floor), await _count(db, Agent)) == (1, 3, 6)


async def test_seed_does_not_overwrite_or_resurrect(client: AsyncClient, db: AsyncSession) -> None:
    await run_seed(db)
    agents = (await client.get("/api/v1/agents")).json()
    writer = next(a for a in agents if a["role_key"] == "hackernoon_writer")
    coach = next(a for a in agents if a["role_key"] == "interview_coach")

    await client.patch(f"/api/v1/agents/{writer['id']}", json={"system_prompt": "custom"})
    await client.delete(f"/api/v1/agents/{coach['id']}")
    await run_seed(db)

    after = (await client.get("/api/v1/agents", params={"include_archived": True})).json()
    assert len(after) == 6
    assert next(a for a in after if a["id"] == writer["id"])["system_prompt"] == "custom"
    assert next(a for a in after if a["id"] == coach["id"])["archived_at"] is not None


def test_seed_prompts_share_rules() -> None:
    assert len({a.role_key for a in AGENTS}) == 6
    for agent in AGENTS:
        assert COMMON_RULES in agent.system_prompt
    portfolio_evidence = next(a for a in AGENTS if a.role_key == "portfolio_evidence")
    assert "public achievements" in portfolio_evidence.system_prompt


async def test_state_after_seed(client: AsyncClient, db: AsyncSession) -> None:
    await run_seed(db)
    res = await client.get("/api/v1/state")
    assert res.status_code == 200
    floors = res.json()["floors"]

    assert [(f["number"], f["name"], f["kind"], f["capacity"], f["has_director_office"]) for f in floors] == [
        (1, "Reception", "reception", 0, False),
        (2, "Career", "office", 5, False),
        (3, "Engineering", "office", 5, True),
    ]
    assert floors[0]["agents"] == []
    assert sum(len(f["agents"]) for f in floors) == 6
    assert [a["role_key"] for a in floors[1]["agents"]] == [
        "job_search",
        "hackernoon_writer",
        "portfolio_evidence",
        "goals_strategist",
    ]
    assert [a["role_key"] for a in floors[2]["agents"]] == ["code_reviewer", "interview_coach"]
    for agent in floors[1]["agents"] + floors[2]["agents"]:
        assert agent["status"] == "off_site"
        assert agent["current_task"] is None
        assert (agent["queue_length"], agent["awaiting_review"]) == (0, 0)


async def test_state_current_task_priority_and_counters(
    client: AsyncClient,
    db: AsyncSession,
    make_floor: Factory,
    make_agent: Factory,
    make_task: Factory,
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    t1, t2, t3, t4, t5 = [await make_task(agent["id"], title=f"t{i}") for i in range(1, 6)]

    await task_service.start(db, t1["id"])
    await task_service.pause(db, t1["id"])
    await task_service.start(db, t2["id"])
    await task_service.submit_for_review(db, t2["id"])
    await task_service.start(db, t3["id"])

    async def snapshot() -> dict:
        state = (await client.get("/api/v1/state")).json()
        return next(f for f in state["floors"] if f["id"] == floor["id"])["agents"][0]

    s = await snapshot()
    assert s["current_task"]["id"] == t3["id"]
    assert s["current_task"]["status"] == "in_progress"
    assert (s["queue_length"], s["awaiting_review"]) == (2, 1)

    await task_service.pause(db, t3["id"])
    s = await snapshot()
    assert s["current_task"]["id"] == t1["id"]

    await task_service.request_changes(db, t2["id"], "more detail")
    s = await snapshot()
    assert s["current_task"]["id"] == t2["id"]
    assert s["awaiting_review"] == 0

    for t in (t1, t2, t3):
        await task_service.cancel(db, t["id"])
    await task_service.start(db, t4["id"])
    await task_service.submit_for_review(db, t4["id"])
    s = await snapshot()
    assert s["current_task"]["id"] == t4["id"]
    assert (s["queue_length"], s["awaiting_review"]) == (1, 1)
    assert t5["status"] == "queued"


async def test_profile_get_and_put(client: AsyncClient) -> None:
    initial = await client.get("/api/v1/profile")
    assert initial.status_code == 200
    assert initial.json()["name"] == ""

    payload = {
        "name": "Director",
        "summary": "Graduate engineer",
        "goal": "First SWE role",
        "constraints": "UK only",
        "notes": "# Notes\n- one",
    }
    updated = await client.put("/api/v1/profile", json=payload)
    assert updated.status_code == 200
    assert {k: updated.json()[k] for k in payload} == payload

    partial = await client.put("/api/v1/profile", json={"name": "x"})
    assert partial.status_code == 422


async def test_seed_skips_a_taken_desk(db: AsyncSession) -> None:
    await run_seed(db)
    agent = await db.scalar(select(Agent).where(Agent.role_key == "portfolio_evidence"))
    assert agent is not None
    agent.role_key = "renamed_by_director"
    await db.commit()

    report = await run_seed(db)

    assert "agent portfolio_evidence (desk taken)" in report.skipped
    assert await _count(db, Agent) == 6
