"""
tools/instrument_list/models.py
--------------------------------
Definizione tabelle SQLAlchemy per il tool Instrument List.

Tabelle:
- InstrumentRow  : ogni riga della lista strumenti
- InstrumentNote : nota unica per progetto (fondo tabella)
- InstrumentRev  : revisione attiva del progetto per questo tool
"""

from sqlalchemy import (
    Column, Integer, String, Text,
    DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.sql import func
from database import Base


# ============================================================
# TABELLA PRINCIPALE — righe strumenti
# ============================================================

class InstrumentRow(Base):
    __tablename__ = "instrument_list_rows"

    id         = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # Campi tecnici
    rev        = Column(String(20),  nullable=True, default="A")
    fase       = Column(String(50),  nullable=True)
    pid        = Column(String(100), nullable=True)
    tag        = Column(String(100), nullable=False)
    servizio   = Column(String(200), nullable=True)
    tipo       = Column(String(50),  nullable=True)
    standard   = Column(String(100), nullable=True)
    classe     = Column(String(50),  nullable=True)
    attacco    = Column(String(100), nullable=True)
    range      = Column(String(100), nullable=True)
    note       = Column(Text,        nullable=True)

    # Log delle modifiche sulla riga nella revisione corrente
    # Formato: "2024-01-15 REV B: TAG modificato da 'PT-101' a 'PT-102'"
    row_log    = Column(Text, nullable=True)

    # Metadati
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # TAG univoco per progetto — due strumenti dello stesso progetto
    # non possono avere lo stesso TAG
    __table_args__ = (
        UniqueConstraint("project_id", "tag", name="uq_instrument_tag_per_project"),
    )


# ============================================================
# NOTA DEL TOOL — una sola per progetto
# ============================================================

class InstrumentNote(Base):
    __tablename__ = "instrument_list_notes"

    id         = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    content    = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ============================================================
# REVISIONE ATTIVA — una sola per progetto
# ============================================================

class InstrumentRev(Base):
    __tablename__ = "instrument_list_revs"

    id         = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Revisione corrente (es. "A", "B", "C" oppure "00", "01"...)
    current_rev = Column(String(20), nullable=False, default="A")
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())