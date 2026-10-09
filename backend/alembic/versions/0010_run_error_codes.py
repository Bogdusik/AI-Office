"""runs: a code and parameters next to the error text, so the interface can show it in the chosen language

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-09

Data: older runs keep their error text and get no code; the interface shows that text as it is.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("error_code", sa.String(length=64), nullable=True))
    op.add_column("runs", sa.Column("error_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "error_params")
    op.drop_column("runs", "error_code")
