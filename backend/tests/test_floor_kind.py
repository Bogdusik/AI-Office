import pytest
from httpx import AsyncClient

from app.models.enums import FloorKind
from app.services import rules
from app.services.errors import ConflictError, ValidationFailedError
from tests.conftest import Factory


def test_capacity_must_match_kind() -> None:
    rules.ensure_capacity_matches_kind(FloorKind.RECEPTION, 0)
    rules.ensure_capacity_matches_kind(FloorKind.OFFICE, 1)
    with pytest.raises(ValidationFailedError):
        rules.ensure_capacity_matches_kind(FloorKind.RECEPTION, 3)
    with pytest.raises(ValidationFailedError):
        rules.ensure_capacity_matches_kind(FloorKind.OFFICE, 0)


def test_only_office_floors_accept_agents() -> None:
    rules.ensure_floor_accepts_agents(FloorKind.OFFICE)
    with pytest.raises(ConflictError):
        rules.ensure_floor_accepts_agents(FloorKind.RECEPTION)


async def test_reception_defaults_to_zero_capacity(client: AsyncClient) -> None:
    res = await client.post("/api/v1/floors", json={"number": 1, "name": "Lobby", "kind": "reception"})
    assert res.status_code == 201
    assert (res.json()["kind"], res.json()["capacity"]) == ("reception", 0)

    office = await client.post("/api/v1/floors", json={"number": 2, "name": "Work"})
    assert (office.json()["kind"], office.json()["capacity"]) == ("office", 5)


@pytest.mark.parametrize(
    "payload",
    [
        {"number": 1, "name": "Lobby", "kind": "reception", "capacity": 2},
        {"number": 1, "name": "Work", "kind": "office", "capacity": 0},
    ],
)
async def test_capacity_kind_mismatch_is_422(client: AsyncClient, payload: dict) -> None:
    assert (await client.post("/api/v1/floors", json=payload)).status_code == 422


async def test_single_reception(client: AsyncClient) -> None:
    await client.post("/api/v1/floors", json={"number": 1, "name": "Lobby", "kind": "reception"})
    second = await client.post("/api/v1/floors", json={"number": 9, "name": "Lobby 2", "kind": "reception"})
    assert second.status_code == 409


async def test_no_agents_on_reception(client: AsyncClient, make_floor: Factory) -> None:
    lobby = (await client.post("/api/v1/floors", json={"number": 1, "name": "Lobby", "kind": "reception"})).json()
    res = await client.post(
        "/api/v1/agents",
        json={"floor_id": lobby["id"], "name": "A", "role_key": "a", "title": "t"},
    )
    assert res.status_code == 409
    assert "office floors" in res.json()["detail"]

    office = await make_floor(number=2)
    agent = (
        await client.post(
            "/api/v1/agents", json={"floor_id": office["id"], "name": "B", "role_key": "b", "title": "t"}
        )
    ).json()
    moved = await client.patch(f"/api/v1/agents/{agent['id']}", json={"floor_id": lobby["id"]})
    assert moved.status_code == 409
    assert "office floors" in moved.json()["detail"]


async def test_change_kind(client: AsyncClient, make_floor: Factory, make_agent: Factory) -> None:
    floor = await make_floor(number=4)
    agent = await make_agent(floor["id"])

    busy = await client.patch(f"/api/v1/floors/{floor['id']}", json={"kind": "reception"})
    assert busy.status_code == 409

    await client.delete(f"/api/v1/agents/{agent['id']}")
    ok = await client.patch(f"/api/v1/floors/{floor['id']}", json={"kind": "reception"})
    assert ok.status_code == 200
    assert (ok.json()["kind"], ok.json()["capacity"]) == ("reception", 0)

    back = await client.patch(f"/api/v1/floors/{floor['id']}", json={"kind": "office", "capacity": 3})
    assert (back.json()["kind"], back.json()["capacity"]) == ("office", 3)

    bad = await client.patch(f"/api/v1/floors/{floor['id']}", json={"capacity": 0})
    assert bad.status_code == 422
