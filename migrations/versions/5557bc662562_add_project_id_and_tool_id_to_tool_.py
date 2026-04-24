"""add project_id and tool_id to tool_templates

Revision ID: 5557bc662562
Revises: 1455d61d08eb
Create Date: 2026-04-24 01:22:06.519904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5557bc662562'
down_revision: Union[str, Sequence[str], None] = '1455d61d08eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tool_templates", sa.Column("project_id", sa.Integer(), nullable=True))
    op.add_column("tool_templates", sa.Column("tool_id",    sa.Integer(), nullable=True))
    op.create_index("ix_tool_templates_project_id", "tool_templates", ["project_id"])
    op.create_index("ix_tool_templates_tool_id",    "tool_templates", ["tool_id"])


def downgrade() -> None:
    op.drop_index("ix_tool_templates_tool_id",    table_name="tool_templates")
    op.drop_index("ix_tool_templates_project_id", table_name="tool_templates")
    op.drop_column("tool_templates", "tool_id")
    op.drop_column("tool_templates", "project_id")
