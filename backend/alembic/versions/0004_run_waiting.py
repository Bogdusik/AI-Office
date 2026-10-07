"""runs: `waiting` status (queued for the model before the request is sent)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_runs_run_status"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_status"),
        "runs",
        "status IN ('waiting', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled')",
    )


def downgrade() -> None:
    op.execute("UPDATE runs SET status = 'interrupted' WHERE status = 'waiting'")
    op.drop_constraint(op.f("ck_runs_run_status"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_status"),
        "runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled')",
    )
