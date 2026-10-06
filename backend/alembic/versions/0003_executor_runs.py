"""runs for the executor: stage output, attempt (result version), interrupted/cancelled runs, fake provider

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-06

`attempt` is the artifact version a run works towards; old rows belong to version 1.
Downgrade maps interrupted/cancelled runs to failed and fake runs to ollama before restoring the old checks.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("output", sa.Text(), server_default="", nullable=False))
    op.add_column("runs", sa.Column("attempt", sa.Integer(), server_default="1", nullable=False))
    op.drop_constraint(op.f("ck_runs_run_status"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_status"),
        "runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled')",
    )
    op.drop_constraint(op.f("ck_runs_run_provider"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_provider"), "runs", "provider IN ('ollama', 'anthropic', 'fake')"
    )
    op.create_index("ix_runs_task_attempt", "runs", ["task_id", "attempt"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_runs_task_attempt", table_name="runs")
    op.execute("UPDATE runs SET status = 'failed' WHERE status IN ('interrupted', 'cancelled')")
    op.execute("UPDATE runs SET provider = 'ollama' WHERE provider = 'fake'")
    op.drop_constraint(op.f("ck_runs_run_provider"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_provider"), "runs", "provider IN ('ollama', 'anthropic')"
    )
    op.drop_constraint(op.f("ck_runs_run_status"), "runs", type_="check")
    op.create_check_constraint(
        op.f("ck_runs_run_status"), "runs", "status IN ('running', 'succeeded', 'failed')"
    )
    op.drop_column("runs", "attempt")
    op.drop_column("runs", "output")
