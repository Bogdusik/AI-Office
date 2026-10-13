"""The API answers only this computer, and only its own pages may change data (audit H3, M1, M2, L1)."""

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import Factory

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("host", ["attacker.example", "attacker.example:8000", "192.168.1.20:8000"])
async def test_a_foreign_host_header_is_refused(client: AsyncClient, host: str) -> None:
    for path in ("/health", "/api/v1/profile", "/llms.txt"):
        assert (await client.get(path, headers={"Host": host})).status_code == 400


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1:8000", "localhost"])
async def test_local_host_names_are_served(client: AsyncClient, host: str) -> None:
    assert (await client.get("/api/v1/profile", headers={"Host": host})).status_code == 200


@pytest.fixture
async def queued(make_floor: Factory, make_agent: Factory, make_task: Factory) -> dict[str, Any]:
    floor = await make_floor()
    agent = await make_agent(floor["id"])
    return await make_task(agent["id"])


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example"},
        {"Origin": "http://localhost:9002"},
        {"Origin": "null"},
        {"Sec-Fetch-Site": "cross-site"},
    ],
)
async def test_a_bodyless_post_from_another_site_changes_nothing(client: AsyncClient, queued: dict[str, Any], headers: dict[str, str]) -> None:
    res = await client.post(f"/api/v1/tasks/{queued['id']}/cancel", headers=headers)
    assert res.status_code == 403
    assert (await client.get(f"/api/v1/tasks/{queued['id']}")).json()["status"] == "queued"
    assert (await client.post("/api/v1/agents/release-all", headers=headers)).status_code == 403


async def test_other_methods_from_another_site_are_refused(client: AsyncClient, queued: dict[str, Any]) -> None:
    evil = {"Origin": "https://evil.example"}
    assert (await client.put("/api/v1/profile", json={"name": "x"}, headers=evil)).status_code == 403
    assert (await client.delete(f"/api/v1/tasks/{queued['id']}", headers=evil)).status_code == 403


async def test_the_app_page_and_local_tools_may_change_data(client: AsyncClient, queued: dict[str, Any]) -> None:
    own = {"Origin": "http://localhost:3000", "Sec-Fetch-Site": "same-site"}
    assert (await client.post(f"/api/v1/tasks/{queued['id']}/pause", headers=own)).status_code in (200, 409)
    assert (await client.post(f"/api/v1/tasks/{queued['id']}/cancel")).status_code == 200


def test_reading_from_another_site_stays_possible_only_through_cors() -> None:
    """GET is not refused by the origin check (CORS keeps the response from foreign pages)."""
    from app.core.origin import SAFE_METHODS

    assert SAFE_METHODS == {"GET", "HEAD", "OPTIONS"}


def test_postgres_and_the_dev_server_listen_on_loopback_only() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    ports = [line.strip() for line in compose.splitlines() if line.strip().startswith('- "') and ":" in line and "${" in line]
    assert ports and all(p.startswith(('- "127.0.0.1:', '- "[::1]:')) for p in ports), ports
    # localhost resolves to ::1 first on Windows; without the IPv6 loopback every connection waits ~2 s for a refusal
    assert '- "[::1]:${POSTGRES_PORT:-5433}:5432"' in compose
    start = (ROOT / "start.ps1").read_text(encoding="utf-8")
    assert "'run', 'dev', '--', '-p', $FrontendPort, '-H', '127.0.0.1'" in start
