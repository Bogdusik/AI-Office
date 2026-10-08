"""agents: tool sets besides the web; runs and artifacts: vacancies found by the job tools

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-08

Data: no agent gets a tool here; the seed gives the job search agent `jobs`, existing databases are set per agent.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("tools", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False))
    op.add_column("runs", sa.Column("jobs", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("artifacts", sa.Column("jobs", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("artifacts", "jobs")
    op.drop_column("runs", "jobs")
    op.drop_column("agents", "tools")
