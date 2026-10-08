"""agents: start of the current status and the latest trip (arriving or leaving)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("status_since", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.add_column(
        "agents",
        sa.Column(
            "trip_kind",
            sa.Enum("arrive", "depart", name="trip_kind", native_enum=False, create_constraint=False, length=32),
            nullable=True,
        ),
    )
    op.add_column("agents", sa.Column("trip_started_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(op.f("ck_agents_trip_kind"), "agents", "trip_kind IN ('arrive', 'depart')")
    op.create_check_constraint(
        op.f("ck_agents_trip_complete"), "agents", "(trip_kind IS NULL) = (trip_started_at IS NULL)"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_agents_trip_complete"), "agents", type_="check")
    op.drop_constraint(op.f("ck_agents_trip_kind"), "agents", type_="check")
    op.drop_column("agents", "trip_started_at")
    op.drop_column("agents", "trip_kind")
    op.drop_column("agents", "status_since")
