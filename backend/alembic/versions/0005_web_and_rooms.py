"""runs: web activity and generation speed; floors: server room and kitchen flags

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-07

Data: the floor named "Engineering" gets the server room, "Career" the kitchen (when they exist and are offices).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("activity", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.add_column("runs", sa.Column("tokens_per_second", sa.Float(), nullable=True))
    op.add_column("floors", sa.Column("has_server_room", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("floors", sa.Column("has_kitchen", sa.Boolean(), server_default="false", nullable=False))
    op.create_check_constraint(
        op.f("ck_floors_rooms_on_office_floors"),
        "floors",
        "kind = 'office' OR (NOT has_server_room AND NOT has_kitchen)",
    )
    op.create_index(
        "uq_floors_single_server_room", "floors", ["has_server_room"], unique=True,
        postgresql_where=sa.text("has_server_room"),
    )
    op.create_index(
        "uq_floors_single_kitchen", "floors", ["has_kitchen"], unique=True, postgresql_where=sa.text("has_kitchen")
    )
    op.execute("UPDATE floors SET has_server_room = true WHERE name = 'Engineering' AND kind = 'office'")
    op.execute("UPDATE floors SET has_kitchen = true WHERE name = 'Career' AND kind = 'office'")


def downgrade() -> None:
    op.drop_index("uq_floors_single_kitchen", table_name="floors")
    op.drop_index("uq_floors_single_server_room", table_name="floors")
    op.drop_constraint(op.f("ck_floors_rooms_on_office_floors"), "floors", type_="check")
    op.drop_column("floors", "has_kitchen")
    op.drop_column("floors", "has_server_room")
    op.drop_column("runs", "tokens_per_second")
    op.drop_column("runs", "activity")
