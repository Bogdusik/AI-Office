"""floor kind: reception | office; restructure floors so floor 1 is the reception

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-06

Existing data: every floor moves up one number and a "Reception" floor is inserted as number 1.
Agents, tasks and everything below them stay untouched: they reference floors by id, not by number.
On an empty database nothing is inserted; the seed creates the floors.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SHIFT = 100_000


def upgrade() -> None:
    op.add_column(
        "floors",
        sa.Column(
            "kind",
            sa.Enum("reception", "office", name="floor_kind", native_enum=False, create_constraint=False, length=32),
            server_default="office",
            nullable=False,
        ),
    )
    op.create_check_constraint(op.f("ck_floors_floor_kind"), "floors", "kind IN ('reception', 'office')")
    op.drop_constraint(op.f("ck_floors_capacity_positive"), "floors", type_="check")
    op.create_check_constraint(
        op.f("ck_floors_capacity_matches_kind"),
        "floors",
        "(kind = 'reception' AND capacity = 0) OR (kind = 'office' AND capacity > 0)",
    )
    op.create_index(
        "uq_floors_single_reception",
        "floors",
        ["kind"],
        unique=True,
        postgresql_where=sa.text("kind = 'reception'"),
    )

    # Two steps so the UNIQUE(number) constraint never sees a collision mid-update.
    op.execute(f"UPDATE floors SET number = number + {SHIFT}")
    op.execute(f"UPDATE floors SET number = number - {SHIFT} + 1")
    op.execute(
        """
        INSERT INTO floors (number, name, kind, capacity, has_director_office)
        SELECT 1, 'Reception', 'reception', 0, false
        WHERE EXISTS (SELECT 1 FROM floors)
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM floors WHERE kind = 'reception'")
    op.execute(f"UPDATE floors SET number = number + {SHIFT}")
    op.execute(f"UPDATE floors SET number = number - {SHIFT} - 1")
    op.drop_index("uq_floors_single_reception", table_name="floors", postgresql_where=sa.text("kind = 'reception'"))
    op.drop_constraint(op.f("ck_floors_capacity_matches_kind"), "floors", type_="check")
    op.create_check_constraint(op.f("ck_floors_capacity_positive"), "floors", "capacity > 0")
    op.drop_constraint(op.f("ck_floors_floor_kind"), "floors", type_="check")
    op.drop_column("floors", "kind")
