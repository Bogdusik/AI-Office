from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import tasks as task_service
from app.services.rules import TransitionError
from tests.conftest import Factory


@pytest.fixture
async def agent(make_floor: Factory, make_agent: Factory) -> dict[str, Any]:
    floor = await make_floor()
    return await make_agent(floor["id"])


async def _to_review(db: AsyncSession, task_id: int) -> None:
    await task_service.start(db, task_id)
    await task_service.submit_for_review(db, task_id)


async def test_happy_path_with_changes_requested(
    client: AsyncClient, db: AsyncSession, agent: dict[str, Any], make_task: Factory
) -> None:
    task = await make_task(agent["id"])
    assert task["status"] == "queued"
    assert task["started_at"] is None

    await _to_review(db, task["id"])

    res = await client.post(
        f"/api/v1/tasks/{task['id']}/request-changes", json={"body": "Add sources"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "changes_requested"
    assert [(c["author"], c["body"]) for c in body["comments"]] == [("director", "Add sources")]

    resumed = await client.post(f"/api/v1/tasks/{task['id']}/resume")
    assert resumed.json()["status"] == "in_progress"

    await task_service.submit_for_review(db, task["id"])
    done = await client.post(f"/api/v1/tasks/{task['id']}/approve")
    assert done.status_code == 200
    result = done.json()
    assert result["status"] == "done"
    assert result["started_at"] is not None
    assert result["finished_at"] is not None


@pytest.mark.parametrize("payload", [{}, {"body": ""}, {"body": "   "}])
async def test_request_changes_requires_comment(
    client: AsyncClient,
    db: AsyncSession,
    agent: dict[str, Any],
    make_task: Factory,
    payload: dict[str, str],
) -> None:
    task = await make_task(agent["id"])
    await _to_review(db, task["id"])

    res = await client.post(f"/api/v1/tasks/{task['id']}/request-changes", json=payload)
    assert res.status_code == 422

    after = (await client.get(f"/api/v1/tasks/{task['id']}")).json()
    assert after["status"] == "needs_review"
    assert after["comments"] == []


async def test_request_changes_service_requires_comment(
    db: AsyncSession, agent: dict[str, Any], make_task: Factory
) -> None:
    from app.services.errors import ValidationFailedError

    task = await make_task(agent["id"])
    await _to_review(db, task["id"])
    with pytest.raises(ValidationFailedError):
        await task_service.request_changes(db, task["id"], "  ")


@pytest.mark.parametrize(
    "action", ["approve", "pause", "resume"],
)
async def test_invalid_actions_on_queued_task(
    client: AsyncClient, agent: dict[str, Any], make_task: Factory, action: str
) -> None:
    task = await make_task(agent["id"])
    res = await client.post(f"/api/v1/tasks/{task['id']}/{action}")
    assert res.status_code == 409


async def test_request_changes_on_queued_task_is_409(
    client: AsyncClient, agent: dict[str, Any], make_task: Factory
) -> None:
    task = await make_task(agent["id"])
    res = await client.post(f"/api/v1/tasks/{task['id']}/request-changes", json={"body": "x"})
    assert res.status_code == 409


async def test_pause_and_resume(
    client: AsyncClient, db: AsyncSession, agent: dict[str, Any], make_task: Factory
) -> None:
    task = await make_task(agent["id"])
    await task_service.start(db, task["id"])

    paused = await client.post(f"/api/v1/tasks/{task['id']}/pause")
    assert paused.json()["status"] == "paused"
    assert (await client.post(f"/api/v1/tasks/{task['id']}/approve")).status_code == 409

    resumed = await client.post(f"/api/v1/tasks/{task['id']}/resume")
    assert resumed.json()["status"] == "in_progress"
    assert (await client.post(f"/api/v1/tasks/{task['id']}/resume")).status_code == 409


@pytest.mark.parametrize("setup", ["queued", "in_progress", "paused", "needs_review", "changes_requested"])
async def test_cancel_from_any_unfinished(
    client: AsyncClient, db: AsyncSession, agent: dict[str, Any], make_task: Factory, setup: str
) -> None:
    task = await make_task(agent["id"])
    tid = task["id"]
    if setup != "queued":
        await task_service.start(db, tid)
    if setup == "paused":
        await task_service.pause(db, tid)
    if setup in {"needs_review", "changes_requested"}:
        await task_service.submit_for_review(db, tid)
    if setup == "changes_requested":
        await task_service.request_changes(db, tid, "redo")

    res = await client.post(f"/api/v1/tasks/{tid}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    assert res.json()["finished_at"] is not None


@pytest.mark.parametrize("terminal", ["done", "failed", "cancelled"])
async def test_terminal_tasks_are_frozen(
    client: AsyncClient, db: AsyncSession, agent: dict[str, Any], make_task: Factory, terminal: str
) -> None:
    task = await make_task(agent["id"])
    tid = task["id"]
    if terminal == "cancelled":
        await task_service.cancel(db, tid)
    else:
        await task_service.start(db, tid)
        if terminal == "failed":
            await task_service.fail(db, tid)
        else:
            await task_service.submit_for_review(db, tid)
            await task_service.approve(db, tid)

    for action in ("approve", "pause", "resume", "cancel"):
        res = await client.post(f"/api/v1/tasks/{tid}/{action}")
        assert res.status_code == 409, action


async def test_executor_transitions_are_guarded(
    db: AsyncSession, agent: dict[str, Any], make_task: Factory
) -> None:
    task = await make_task(agent["id"])
    with pytest.raises(TransitionError):
        await task_service.fail(db, task["id"])
    with pytest.raises(TransitionError):
        await task_service.submit_for_review(db, task["id"])
    await task_service.start(db, task["id"])
    await task_service.pause(db, task["id"])
    with pytest.raises(TransitionError):
        await task_service.start(db, task["id"])


async def test_positions_and_filters(
    client: AsyncClient, db: AsyncSession, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    a = await make_agent(floor["id"])
    b = await make_agent(floor["id"])
    t1 = await make_task(a["id"])
    t2 = await make_task(a["id"])
    await make_task(b["id"])
    assert (t1["position"], t2["position"]) == (1, 2)

    await task_service.start(db, t1["id"])

    by_agent = (await client.get("/api/v1/tasks", params={"agent_id": a["id"]})).json()
    assert [t["id"] for t in by_agent] == [t1["id"], t2["id"]]

    queued = (
        await client.get("/api/v1/tasks", params={"agent_id": a["id"], "status": "queued"})
    ).json()
    assert [t["id"] for t in queued] == [t2["id"]]

    bad = await client.get("/api/v1/tasks", params={"status": "nope"})
    assert bad.status_code == 422


async def test_comments_and_detail(
    client: AsyncClient, agent: dict[str, Any], make_task: Factory
) -> None:
    task = await make_task(agent["id"])
    res = await client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "Focus on UK"})
    assert res.status_code == 201
    assert res.json()["author"] == "director"

    empty = await client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": " "})
    assert empty.status_code == 422

    detail = (await client.get(f"/api/v1/tasks/{task['id']}")).json()
    assert [c["body"] for c in detail["comments"]] == ["Focus on UK"]
    assert detail["runs"] == []
    assert detail["artifacts"] == []


async def test_task_not_found(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/tasks/999")).status_code == 404
    assert (await client.post("/api/v1/tasks/999/approve")).status_code == 404
    assert (await client.post("/api/v1/tasks", json={"agent_id": 999, "title": "x"})).status_code == 404
