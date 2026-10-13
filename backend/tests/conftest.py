import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parents[1]


async def _recreate_database(url: str) -> None:
    target = make_url(url)
    admin = create_async_engine(
        target.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    async with admin.connect() as conn:
        await conn.exec_driver_sql(f'DROP DATABASE IF EXISTS "{target.database}" WITH (FORCE)')
        await conn.exec_driver_sql(f'CREATE DATABASE "{target.database}"')
    await admin.dispose()


@pytest.fixture(scope="session")
def test_database_url() -> str:
    settings = get_settings()
    url = settings.test_database_url
    if not url:
        pytest.exit("TEST_DATABASE_URL is not set in backend/.env", returncode=2)
    if make_url(url).database == make_url(settings.database_url).database:
        pytest.exit("TEST_DATABASE_URL must point to a separate database", returncode=2)

    asyncio.run(_recreate_database(url))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")
    return url


@pytest.fixture
async def engine(test_database_url: str) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(test_database_url, poolclass=NullPool)
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with eng.begin() as conn:
        await conn.exec_driver_sql(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
    yield eng
    await eng.dispose()


@pytest.fixture
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def db(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as c:
        yield c
    app.dependency_overrides.clear()


Factory = Callable[..., Awaitable[dict[str, Any]]]


@pytest.fixture
def make_floor(client: AsyncClient) -> Factory:
    counter = iter(range(1, 1000))

    async def _make(**overrides: Any) -> dict[str, Any]:
        n = next(counter)
        payload = {"number": n, "name": f"Floor {n}", **overrides}
        res = await client.post("/api/v1/floors", json=payload)
        assert res.status_code == 201, res.text
        return res.json()

    return _make


@pytest.fixture
def make_agent(client: AsyncClient) -> Factory:
    counter = iter(range(1, 1000))

    async def _make(floor_id: int, **overrides: Any) -> dict[str, Any]:
        n = next(counter)
        payload = {
            "floor_id": floor_id,
            "name": f"Agent {n}",
            "role_key": f"role_{n}",
            "title": "Tester",
            **overrides,
        }
        res = await client.post("/api/v1/agents", json=payload)
        assert res.status_code == 201, res.text
        return res.json()

    return _make


@pytest.fixture
def make_task(client: AsyncClient) -> Factory:
    async def _make(agent_id: int, **overrides: Any) -> dict[str, Any]:
        payload = {"agent_id": agent_id, "title": "Do something", **overrides}
        res = await client.post("/api/v1/tasks", json=payload)
        assert res.status_code == 201, res.text
        return res.json()

    return _make
