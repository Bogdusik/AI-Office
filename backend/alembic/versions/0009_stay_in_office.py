"""agents stay in the office: `returning` status, `return` trips, the departure a trip continues

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ("off_site", "arriving", "idle", "working", "waiting_review", "leaving")
TRIPS = ("arrive", "depart")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_agents_agent_status"), "agents", type_="check")
    op.create_check_constraint(op.f("ck_agents_agent_status"), "agents", _in("status", (*STATUSES, "returning")))
    op.drop_constraint(op.f("ck_agents_trip_kind"), "agents", type_="check")
    op.create_check_constraint(op.f("ck_agents_trip_kind"), "agents", _in("trip_kind", (*TRIPS, "return")))
    op.add_column("agents", sa.Column("trip_origin_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.execute("UPDATE agents SET status = 'idle', trip_kind = 'arrive' WHERE status = 'returning'")
    op.execute("UPDATE agents SET trip_kind = 'arrive' WHERE trip_kind = 'return'")
    op.drop_column("agents", "trip_origin_at")
    op.drop_constraint(op.f("ck_agents_trip_kind"), "agents", type_="check")
    op.create_check_constraint(op.f("ck_agents_trip_kind"), "agents", _in("trip_kind", TRIPS))
    op.drop_constraint(op.f("ck_agents_agent_status"), "agents", type_="check")
    op.create_check_constraint(op.f("ck_agents_agent_status"), "agents", _in("status", STATUSES))
