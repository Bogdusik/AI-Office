"""initial

Revision ID: 0001
Revises:
Create Date: 2026-10-06 11:42:50.628418

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('floors',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('capacity', sa.Integer(), server_default='5', nullable=False),
    sa.Column('has_director_office', sa.Boolean(), server_default='false', nullable=False),
    sa.CheckConstraint('capacity > 0', name=op.f('ck_floors_capacity_positive')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_floors')),
    sa.UniqueConstraint('number', name=op.f('uq_floors_number'))
    )
    op.create_table('profile',
    sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('name', sa.String(length=200), server_default='', nullable=False),
    sa.Column('summary', sa.Text(), server_default='', nullable=False),
    sa.Column('goal', sa.Text(), server_default='', nullable=False),
    sa.Column('constraints', sa.Text(), server_default='', nullable=False),
    sa.Column('notes', sa.Text(), server_default='', nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('id = 1', name=op.f('ck_profile_single_row')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_profile'))
    )
    op.create_table('agents',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('floor_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('role_key', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('system_prompt', sa.Text(), server_default='', nullable=False),
    sa.Column('provider', sa.Enum('ollama', 'anthropic', name='provider', native_enum=False, create_constraint=False, length=32), server_default='ollama', nullable=False),
    sa.Column('model', sa.String(length=200), nullable=True),
    sa.Column('web_access', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('desk_index', sa.Integer(), nullable=True),
    sa.Column('status', sa.Enum('off_site', 'arriving', 'idle', 'working', 'waiting_review', 'leaving', name='agent_status', native_enum=False, create_constraint=False, length=32), server_default='off_site', nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("provider IN ('ollama', 'anthropic')", name=op.f('ck_agents_provider')),
    sa.CheckConstraint("status IN ('off_site', 'arriving', 'idle', 'working', 'waiting_review', 'leaving')", name=op.f('ck_agents_agent_status')),
    sa.CheckConstraint('(archived_at IS NULL AND floor_id IS NOT NULL AND desk_index IS NOT NULL) OR (archived_at IS NOT NULL AND floor_id IS NULL AND desk_index IS NULL)', name=op.f('ck_agents_placement_matches_archive')),
    sa.CheckConstraint('desk_index >= 0', name=op.f('ck_agents_desk_index_non_negative')),
    sa.ForeignKeyConstraint(['floor_id'], ['floors.id'], name=op.f('fk_agents_floor_id_floors'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agents')),
    sa.UniqueConstraint('floor_id', 'desk_index', name='uq_agents_floor_desk')
    )
    op.create_index(op.f('ix_agents_floor_id'), 'agents', ['floor_id'], unique=False)
    op.create_index('uq_agents_role_key_active', 'agents', ['role_key'], unique=True, postgresql_where=sa.text('archived_at IS NULL'))
    op.create_table('tasks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('agent_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('description', sa.Text(), server_default='', nullable=False),
    sa.Column('status', sa.Enum('queued', 'in_progress', 'paused', 'needs_review', 'changes_requested', 'done', 'failed', 'cancelled', name='task_status', native_enum=False, create_constraint=False, length=32), server_default='queued', nullable=False),
    sa.Column('stage', sa.Enum('plan', 'research', 'draft', 'self_check', name='task_stage', native_enum=False, create_constraint=False, length=32), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("stage IN ('plan', 'research', 'draft', 'self_check')", name=op.f('ck_tasks_task_stage')),
    sa.CheckConstraint("status IN ('queued', 'in_progress', 'paused', 'needs_review', 'changes_requested', 'done', 'failed', 'cancelled')", name=op.f('ck_tasks_task_status')),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_tasks_agent_id_agents'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tasks'))
    )
    op.create_index('ix_tasks_agent_status_position', 'tasks', ['agent_id', 'status', 'position'], unique=False)
    op.create_table('artifacts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), server_default='', nullable=False),
    sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_artifacts_task_id_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_artifacts')),
    sa.UniqueConstraint('task_id', 'version', name='uq_artifacts_task_version')
    )
    op.create_index(op.f('ix_artifacts_task_id'), 'artifacts', ['task_id'], unique=False)
    op.create_table('runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('stage', sa.Enum('plan', 'research', 'draft', 'self_check', name='run_stage', native_enum=False, create_constraint=False, length=32), nullable=False),
    sa.Column('provider', sa.Enum('ollama', 'anthropic', name='run_provider', native_enum=False, create_constraint=False, length=32), nullable=False),
    sa.Column('model', sa.String(length=200), nullable=True),
    sa.Column('input_tokens', sa.Integer(), server_default='0', nullable=False),
    sa.Column('output_tokens', sa.Integer(), server_default='0', nullable=False),
    sa.Column('status', sa.Enum('running', 'succeeded', 'failed', name='run_status', native_enum=False, create_constraint=False, length=32), server_default='running', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("provider IN ('ollama', 'anthropic')", name=op.f('ck_runs_run_provider')),
    sa.CheckConstraint("stage IN ('plan', 'research', 'draft', 'self_check')", name=op.f('ck_runs_run_stage')),
    sa.CheckConstraint("status IN ('running', 'succeeded', 'failed')", name=op.f('ck_runs_run_status')),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_runs_task_id_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_runs'))
    )
    op.create_index(op.f('ix_runs_task_id'), 'runs', ['task_id'], unique=False)
    op.create_table('task_comments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.Integer(), nullable=False),
    sa.Column('author', sa.Enum('director', 'agent', name='comment_author', native_enum=False, create_constraint=False, length=32), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("author IN ('director', 'agent')", name=op.f('ck_task_comments_comment_author')),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_task_comments_task_id_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_task_comments'))
    )
    op.create_index(op.f('ix_task_comments_task_id'), 'task_comments', ['task_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_task_comments_task_id'), table_name='task_comments')
    op.drop_table('task_comments')
    op.drop_index(op.f('ix_runs_task_id'), table_name='runs')
    op.drop_table('runs')
    op.drop_index(op.f('ix_artifacts_task_id'), table_name='artifacts')
    op.drop_table('artifacts')
    op.drop_index('ix_tasks_agent_status_position', table_name='tasks')
    op.drop_table('tasks')
    op.drop_index('uq_agents_role_key_active', table_name='agents', postgresql_where=sa.text('archived_at IS NULL'))
    op.drop_index(op.f('ix_agents_floor_id'), table_name='agents')
    op.drop_table('agents')
    op.drop_table('profile')
    op.drop_table('floors')
