"""
engine/models.py
-----------------
Unico modello SQLAlchemy rimasto nel registry: ToolTemplate.

I tool, le colonne, le righe e le celle vivono ora nei file DB
per-progetto (flat tables, gestiti da engine/project_db.py).
"""

from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from database import Base


class ToolTemplate(Base):
    __tablename__ = "tool_templates"

    id          = Column(Integer, primary_key=True, index=True)
    type_slug   = Column(String(100), nullable=False, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    etl_sql     = Column(Text, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    project_id  = Column(Integer, nullable=True, index=True)
    tool_id     = Column(Integer, nullable=True, index=True)
