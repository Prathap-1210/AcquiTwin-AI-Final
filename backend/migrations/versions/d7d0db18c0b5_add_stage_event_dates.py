"""add stage event dates

Revision ID: d7d0db18c0b5
Revises: eae8fc01449c
Create Date: 2026-09-17 10:26:00.919082

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7d0db18c0b5'
down_revision: Union[str, Sequence[str], None] = 'eae8fc01449c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_stage_history",
        sa.Column("actual_start_date", sa.Date(), nullable=True),
    )

    op.add_column(
        "project_stage_history",
        sa.Column("planned_end_date", sa.Date(), nullable=True),
    )

    op.add_column(
        "project_stage_history",
        sa.Column("actual_completion_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_stage_history", "actual_completion_date")
    op.drop_column("project_stage_history", "planned_end_date")
    op.drop_column("project_stage_history", "actual_start_date")