"""
engine/models.py
-----------------
Tabelle universali del Table Engine.

Queste quattro tabelle sostituiscono le tabelle specifiche
di ogni tool. Qualsiasi tool (Instrument List, Cable List,
I/O List, ecc.) è un'istanza di questo engine.

Tabelle:
- Tool        : registry dei tool per progetto
- ToolColumn  : colonne dinamiche di ogni tool
- ToolRow     : righe universali con soft delete
- ToolCell    : valori delle celle (modello EAV)
"""

from sqlalchemy import (
    Column, Integer, String, Text, Boolean,
    DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


# ============================================================
# TOOL — registry dei tool per progetto
# ============================================================

class Tool(Base):
    __tablename__ = "tools"

    id         = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # Nome visualizzato (es. "Instrument List", "Cable List")
    name       = Column(String(200), nullable=False)

    # Slug URL-safe (es. "instrument-list", "cable-list")
    slug       = Column(String(200), nullable=False)

    # Tipo di tool — slug del catalogo (es. "instrument-list")
    tool_type  = Column(String(100), nullable=True)

    # Configurazione Power Query in JSON
    # Es: {"source_tool_id": 2, "filters": [...], "joins": [...]}
    query_config = Column(Text, nullable=True)

    # Revisione attiva del tool
    current_rev  = Column(String(20), nullable=False, default="A")
    # Icona emoji del tool
    icon = Column(String(10), nullable=True, default="📄")

    # Nota generale del tool
    note         = Column(Text, nullable=True)

    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now())

    # Relazioni
    columns = relationship("ToolColumn", back_populates="tool",
                           cascade="all, delete-orphan",
                           order_by="ToolColumn.position")
    rows    = relationship("ToolRow", back_populates="tool",
                           cascade="all, delete-orphan")

    # Slug univoco per progetto
    __table_args__ = (
        UniqueConstraint("project_id", "slug", name="uq_tool_slug_per_project"),
    )


# ============================================================
# TOOL COLUMN — colonne dinamiche
# ============================================================

class ToolColumn(Base):
    __tablename__ = "tool_columns"

    id       = Column(Integer, primary_key=True, index=True)
    tool_id  = Column(Integer, ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)

    # Nome visualizzato (es. "Servizio", "P&ID")
    name     = Column(String(200), nullable=False)

    # Slug interno (es. "servizio", "pid")
    slug     = Column(String(200), nullable=False)

    # Tipo cella: text | number | select | date | formula
    col_type = Column(String(50), nullable=False, default="text")

    # Larghezza in pixel
    width    = Column(Integer, nullable=False, default=120)

    # Ordine nella tabella
    position = Column(Integer, nullable=False, default=0)

    # Colonne di sistema (TAG, REV, LOG) — non eliminabili né rinominabili
    is_system    = Column(Boolean, nullable=False, default=False)

    # Formula per colonne calcolate (es. "={col_tag} + '-' + {col_tipo}")
    formula      = Column(Text, nullable=True)

    # Relazioni
    tool  = relationship("Tool", back_populates="columns")
    cells = relationship("ToolCell", back_populates="column",
                         cascade="all, delete-orphan")

    # Slug univoco per tool
    __table_args__ = (
        UniqueConstraint("tool_id", "slug", name="uq_column_slug_per_tool"),
    )


# ============================================================
# TOOL ROW — righe universali
# ============================================================

class ToolRow(Base):
    __tablename__ = "tool_rows"

    id         = Column(Integer, primary_key=True, index=True)
    tool_id    = Column(Integer, ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # Ordine visualizzazione
    position   = Column(Integer, nullable=False, default=0)

    # Revisione al momento della creazione
    rev        = Column(String(20), nullable=True, default="A")

    # Soft delete
    is_deleted  = Column(Boolean, nullable=False, default=False)
    deleted_at  = Column(DateTime(timezone=True), nullable=True)

    # Log modifiche leggibile per riga
    # Formato: "[2024-01-15 10:30 REV B] SERVIZIO: 'X' → 'Y'"
    row_log    = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relazioni
    tool  = relationship("Tool", back_populates="rows")
    cells = relationship("ToolCell", back_populates="row",
                         cascade="all, delete-orphan")


# ============================================================
# TOOL CELL — valori celle (modello EAV)
# ============================================================

class ToolCell(Base):
    __tablename__ = "tool_cells"

    id        = Column(Integer, primary_key=True, index=True)
    row_id    = Column(Integer, ForeignKey("tool_rows.id", ondelete="CASCADE"), nullable=False)
    column_id = Column(Integer, ForeignKey("tool_columns.id", ondelete="CASCADE"), nullable=False)

    # Valore testuale della cella
    value     = Column(Text, nullable=True)

    # True se il valore è stato sovrascritto manualmente
    # rispetto al valore calcolato dalla query/formula
    is_overridden = Column(Boolean, nullable=False, default=False)

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relazioni
    row    = relationship("ToolRow", back_populates="cells")
    column = relationship("ToolColumn", back_populates="cells")

    # Una cella per riga per colonna
    __table_args__ = (
        UniqueConstraint("row_id", "column_id", name="uq_cell_per_row_column"),
    )