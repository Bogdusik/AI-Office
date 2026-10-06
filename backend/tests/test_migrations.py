import asyncio

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from tests.conftest import BACKEND_DIR, _recreate_database

OLD_DATA = [
    "INSERT INTO floors (id, number, name, capacity, has_director_office) VALUES (10, 1, 'Career', 5, false)",
    "INSERT INTO floors (id, number, name, capacity, has_director_office) VALUES (20, 2, 'Engineering', 5, true)",
    "INSERT INTO agents (id, floor_id, name, role_key, title, desk_index) VALUES (1, 10, 'Jordan', 'job_search', 'Jobs', 0)",
    "INSERT INTO agents (id, floor_id, name, role_key, title, desk_index) VALUES (2, 20, 'Casey', 'code_reviewer', 'Review', 0)",
    "INSERT INTO tasks (id, agent_id, title, position) VALUES (1, 2, 'Review PR', 1)",
]


async def _execute(url: str, statements: list[str]) -> None:
    engine = create_async_engine(url, poolclass=NullPool)
    async with engine.begin() as conn:
        for sql in statements:
            await conn.exec_driver_sql(sql)
    await engine.dispose()


async def _fetch(url: str, sql: str) -> list[tuple]:
    engine = create_async_engine(url, poolclass=NullPool)
    async with engine.connect() as conn:
        rows = (await conn.exec_driver_sql(sql)).all()
    await engine.dispose()
    return [tuple(r) for r in rows]


def _floors(url: str) -> list[tuple]:
    return asyncio.run(_fetch(url, "SELECT id, number, name, capacity FROM floors ORDER BY number"))


def test_0002_moves_existing_floors_up_and_back(test_database_url: str) -> None:
    base = make_url(test_database_url)
    url = base.set(database=f"{base.database}_migrations").render_as_string(hide_password=False)
    asyncio.run(_recreate_database(url))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["database_url"] = url

    command.upgrade(cfg, "0001")
    asyncio.run(_execute(url, OLD_DATA))

    command.upgrade(cfg, "head")
    floors = asyncio.run(_fetch(url, "SELECT id, number, name, kind, capacity FROM floors ORDER BY number"))
    assert [f[1:] for f in floors] == [
        (1, "Reception", "reception", 0),
        (2, "Career", "office", 5),
        (3, "Engineering", "office", 5),
    ]
    assert [f[0] for f in floors[1:]] == [10, 20]
    agents = asyncio.run(_fetch(url, "SELECT id, floor_id, desk_index FROM agents ORDER BY id"))
    assert agents == [(1, 10, 0), (2, 20, 0)]
    assert asyncio.run(_fetch(url, "SELECT id, agent_id FROM tasks")) == [(1, 2)]

    command.downgrade(cfg, "0001")
    assert _floors(url) == [(10, 1, "Career", 5), (20, 2, "Engineering", 5)]
    assert asyncio.run(_fetch(url, "SELECT count(*) FROM agents")) == [(2,)]


def test_0002_on_empty_database_inserts_nothing(test_database_url: str) -> None:
    base = make_url(test_database_url)
    url = base.set(database=f"{base.database}_migrations").render_as_string(hide_password=False)
    asyncio.run(_recreate_database(url))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")
    assert _floors(url) == []
