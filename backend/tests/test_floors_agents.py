from httpx import AsyncClient

from tests.conftest import Factory


async def test_floor_capacity_limit(client: AsyncClient, make_floor: Factory, make_agent: Factory) -> None:
    floor = await make_floor(capacity=2)
    await make_agent(floor["id"])
    await make_agent(floor["id"])

    res = await client.post(
        "/api/v1/agents",
        json={"floor_id": floor["id"], "name": "Extra", "role_key": "extra", "title": "x"},
    )
    assert res.status_code == 409
    assert "full" in res.json()["detail"]


async def test_desk_is_auto_assigned_and_unique(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor(capacity=3)
    first = await make_agent(floor["id"], desk_index=1)
    second = await make_agent(floor["id"])
    assert (first["desk_index"], second["desk_index"]) == (1, 0)

    taken = await client.post(
        "/api/v1/agents",
        json={"floor_id": floor["id"], "name": "X", "role_key": "x", "title": "x", "desk_index": 1},
    )
    assert taken.status_code == 409

    out_of_range = await client.post(
        "/api/v1/agents",
        json={"floor_id": floor["id"], "name": "Y", "role_key": "y", "title": "y", "desk_index": 3},
    )
    assert out_of_range.status_code == 409


async def test_duplicate_floor_number(client: AsyncClient, make_floor: Factory) -> None:
    await make_floor(number=7)
    res = await client.post("/api/v1/floors", json={"number": 7, "name": "Dup"})
    assert res.status_code == 409


async def test_capacity_cannot_drop_below_agents(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor(capacity=3)
    await make_agent(floor["id"])
    await make_agent(floor["id"])
    res = await client.patch(f"/api/v1/floors/{floor['id']}", json={"capacity": 1})
    assert res.status_code == 409
    ok = await client.patch(f"/api/v1/floors/{floor['id']}", json={"capacity": 2})
    assert ok.status_code == 200
    assert ok.json()["capacity"] == 2


async def test_delete_floor_only_when_empty(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])

    blocked = await client.delete(f"/api/v1/floors/{floor['id']}")
    assert blocked.status_code == 409

    assert (await client.delete(f"/api/v1/agents/{agent['id']}")).status_code == 204
    assert (await client.delete(f"/api/v1/floors/{floor['id']}")).status_code == 204
    assert (await client.get(f"/api/v1/floors/{floor['id']}")).status_code == 404


async def test_move_agent_to_full_floor(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    full = await make_floor(capacity=1)
    await make_agent(full["id"])
    other = await make_floor()
    mover = await make_agent(other["id"])

    res = await client.patch(f"/api/v1/agents/{mover['id']}", json={"floor_id": full["id"]})
    assert res.status_code == 409


async def test_move_agent_between_floors(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    a = await make_floor()
    b = await make_floor()
    await make_agent(b["id"])
    mover = await make_agent(a["id"])

    res = await client.patch(f"/api/v1/agents/{mover['id']}", json={"floor_id": b["id"]})
    assert res.status_code == 200
    assert (res.json()["floor_id"], res.json()["desk_index"]) == (b["id"], 1)


async def test_patch_rejects_null_for_required_field(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"], model="llama3.1")

    bad = await client.patch(f"/api/v1/agents/{agent['id']}", json={"name": None})
    assert bad.status_code == 422

    cleared = await client.patch(f"/api/v1/agents/{agent['id']}", json={"model": None})
    assert cleared.status_code == 200
    assert cleared.json()["model"] is None


async def test_duplicate_role_key(client: AsyncClient, make_floor: Factory, make_agent: Factory) -> None:
    floor = await make_floor()
    await make_agent(floor["id"], role_key="writer")
    res = await client.post(
        "/api/v1/agents",
        json={"floor_id": floor["id"], "name": "W2", "role_key": "writer", "title": "x"},
    )
    assert res.status_code == 409


async def test_archive_blocked_by_unfinished_tasks(
    client: AsyncClient, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    task = await make_task(agent["id"])

    blocked = await client.delete(f"/api/v1/agents/{agent['id']}")
    assert blocked.status_code == 409

    await client.post(f"/api/v1/tasks/{task['id']}/cancel")
    assert (await client.delete(f"/api/v1/agents/{agent['id']}")).status_code == 204


async def test_archive_keeps_history_and_frees_desk(
    client: AsyncClient, make_floor: Factory, make_agent: Factory, make_task: Factory
) -> None:
    floor = await make_floor(capacity=1)
    agent = await make_agent(floor["id"], role_key="writer")
    task = await make_task(agent["id"])
    await client.post(f"/api/v1/tasks/{task['id']}/cancel")
    await client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "keep me"})

    assert (await client.delete(f"/api/v1/agents/{agent['id']}")).status_code == 204

    archived = (await client.get(f"/api/v1/agents/{agent['id']}")).json()
    assert archived["archived_at"] is not None
    assert (archived["floor_id"], archived["desk_index"]) == (None, None)

    history = await client.get(f"/api/v1/tasks/{task['id']}")
    assert history.status_code == 200
    assert history.json()["agent_id"] == agent["id"]
    assert [c["body"] for c in history.json()["comments"]] == ["keep me"]

    active = (await client.get("/api/v1/agents")).json()
    assert agent["id"] not in [a["id"] for a in active]
    everyone = (await client.get("/api/v1/agents", params={"include_archived": True})).json()
    assert agent["id"] in [a["id"] for a in everyone]

    replacement = await make_agent(floor["id"], role_key="writer")
    assert replacement["desk_index"] == 0

    state = (await client.get("/api/v1/state")).json()
    floor_state = next(f for f in state["floors"] if f["id"] == floor["id"])
    assert [a["id"] for a in floor_state["agents"]] == [replacement["id"]]


async def test_archived_agent_is_read_only(
    client: AsyncClient, make_floor: Factory, make_agent: Factory
) -> None:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    await client.delete(f"/api/v1/agents/{agent['id']}")

    assert (await client.patch(f"/api/v1/agents/{agent['id']}", json={"name": "Z"})).status_code == 409
    assert (await client.delete(f"/api/v1/agents/{agent['id']}")).status_code == 409
    new_task = await client.post("/api/v1/tasks", json={"agent_id": agent["id"], "title": "t"})
    assert new_task.status_code == 409


async def test_not_found(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/agents/999")).status_code == 404
    assert (await client.get("/api/v1/floors/999")).status_code == 404
    assert (await client.post("/api/v1/agents", json={"floor_id": 999, "name": "a", "role_key": "a", "title": "a"})).status_code == 404
