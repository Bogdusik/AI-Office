"""job_api_usage: requests sent to each job API per UTC day, for the daily limits

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-13

Data: none; counting starts at zero on the first request.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_api_usage",
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("requests", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("provider", "day", name=op.f("pk_job_api_usage")),
    )


def downgrade() -> None:
    op.drop_table("job_api_usage")
