"""
core/audit.py
-------------
Sistema centralizzato di audit log.
Registra ogni modifica (INSERT, UPDATE, DELETE) su qualsiasi tool.
Ogni tool chiama write_log() passando i propri dati — questo modulo
non conosce i dettagli dei tool, si limita a scrivere sul DB.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from database import Base


# ============================================================
# MODELLO — tabella audit_log
# ============================================================

class AuditLog(Base):
    __tablename__ = "audit_log"

    id         = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tool       = Column(String(100), nullable=False)   # es. "instrument_list"
    action     = Column(String(20),  nullable=False)   # INSERT | UPDATE | DELETE
    row_id     = Column(Integer, nullable=True)        # id della riga modificata
    field      = Column(String(100), nullable=True)    # campo modificato (solo per UPDATE)
    old_value  = Column(Text, nullable=True)           # valore precedente
    new_value  = Column(Text, nullable=True)           # valore nuovo
    timestamp  = Column(DateTime(timezone=True), server_default=func.now())


# ============================================================
# FUNZIONI DI SCRITTURA
# ============================================================

def write_log(
    db: Session,
    project_id: int,
    tool: str,
    action: str,
    row_id: int = None,
    field: str = None,
    old_value: str = None,
    new_value: str = None
) -> AuditLog:
    """
    Scrive una riga nel log centrale.

    Parametri:
    - db         : sessione SQLAlchemy attiva
    - project_id : progetto a cui appartiene la modifica
    - tool       : nome del tool (es. "instrument_list")
    - action     : "INSERT" | "UPDATE" | "DELETE"
    - row_id     : id della riga modificata nel tool
    - field      : nome del campo modificato (solo per UPDATE)
    - old_value  : valore precedente come stringa (solo per UPDATE/DELETE)
    - new_value  : valore nuovo come stringa (solo per INSERT/UPDATE)
    """
    entry = AuditLog(
        project_id=project_id,
        tool=tool,
        action=action,
        row_id=row_id,
        field=field,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
    )
    db.add(entry)
    # Non facciamo commit qui — lo fa il chiamante,
    # così la scrittura del log è atomica con la modifica principale.
    return entry


# ============================================================
# FUNZIONI DI LETTURA
# ============================================================

def get_log_for_project(
    db: Session,
    project_id: int,
    tool: str = None,
    limit: int = 200
) -> list[AuditLog]:
    """
    Restituisce il log di un progetto, opzionalmente filtrato per tool.
    Ordinato dal più recente al più vecchio.
    """
    query = db.query(AuditLog).filter(AuditLog.project_id == project_id)
    if tool:
        query = query.filter(AuditLog.tool == tool)
    return query.order_by(AuditLog.timestamp.desc()).limit(limit).all()


def get_log_for_row(
    db: Session,
    project_id: int,
    tool: str,
    row_id: int
) -> list[AuditLog]:
    """
    Restituisce tutto il log per una specifica riga di un tool.
    Usato per mostrare la storia di un singolo strumento.
    """
    return (
        db.query(AuditLog)
        .filter(
            AuditLog.project_id == project_id,
            AuditLog.tool == tool,
            AuditLog.row_id == row_id
        )
        .order_by(AuditLog.timestamp.desc())
        .all()
    )