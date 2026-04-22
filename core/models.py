import re
from pathlib import Path
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from database import Base


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text or "progetto"


class Project(Base):
    __tablename__ = "projects"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)
    client      = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    db_path     = Column(String(500), nullable=False)   # relativo a data/
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    @staticmethod
    def make_db_filename(client: str, name: str) -> str:
        parts = []
        if client and client.strip():
            parts.append(_slugify(client.strip()))
        parts.append(_slugify(name.strip()) or "progetto")
        return "_".join(parts) + ".db"
