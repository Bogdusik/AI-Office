"""agents: log of the latest activities (status, with work split into working / waiting for the model)

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-08

Data: every agent starts with one entry — its current status since `status_since`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("activity_log", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.execute(
        "UPDATE agents SET activity_log = jsonb_build_array(jsonb_build_object('kind', status, 'since', to_jsonb(status_since)))"
    )


def downgrade() -> None:
    op.drop_column("agents", "activity_log")
