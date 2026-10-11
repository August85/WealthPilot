"""export artifacts table (postgres storage backend for serverless hosts)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11 00:00:00

Idempotent: the table and index are created only when missing, so re-running against a database where they
already exist (e.g. a Neon preview branch copied from production) is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('export_artifacts'):
        op.create_table('export_artifacts',
        sa.Column('key', sa.String(length=500), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('key', name=op.f('pk_export_artifacts'))
        )
    op.execute('CREATE INDEX IF NOT EXISTS ix_export_artifacts_expires_at ON export_artifacts (expires_at)')


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_export_artifacts_expires_at')
    op.execute('DROP TABLE IF EXISTS export_artifacts')
