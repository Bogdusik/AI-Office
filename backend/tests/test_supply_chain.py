"""No third-party code runs in the API's origin, and the search image does not change by itself (audit N2, L7)."""

import re
from pathlib import Path

from httpx import AsyncClient

from app.main import docs_urls

ROOT = Path(__file__).resolve().parents[2]


async def test_interactive_docs_are_off_by_default(client: AsyncClient) -> None:
    for path in ("/docs", "/redoc", "/docs/oauth2-redirect"):
        assert (await client.get(path)).status_code == 404
    assert (await client.get("/openapi.json")).status_code == 200
    assert (await client.get("/llms.txt")).status_code == 200


def test_interactive_docs_can_be_turned_on() -> None:
    assert docs_urls(True) == {"docs_url": "/docs", "redoc_url": "/redoc"}
    assert docs_urls(False) == {"docs_url": None, "redoc_url": None}


def test_container_images_are_pinned() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    images = re.findall(r"^\s*image:\s*(\S+)", compose, re.MULTILINE)
    searxng = next(i for i in images if i.startswith("searxng/"))
    assert not searxng.endswith(":latest") and re.search(r":\d{4}\.\d+\.\d+-\w+@sha256:[0-9a-f]{64}$", searxng), searxng
