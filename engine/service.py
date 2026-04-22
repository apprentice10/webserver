"""
engine/service.py
------------------
Business logic universale del Table Engine.

Responsabilità:
- CRUD tool (creazione, configurazione, settings)
- CRUD colonne dinamiche
- CRUD righe con soft delete
- Lettura/scrittura celle (modello EAV)
- Validazione unicità TAG per progetto
- Gestione revisione attiva
- Scrittura row_log e audit_log
"""

import re
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from core.audit import write_log
from engine.models import Tool, ToolColumn, ToolRow, ToolCell


# ============================================================
# COSTANTI
# ============================================================

# Colonne di sistema — non eliminabili né rinominabili
SYSTEM_COLUMNS = ["tag", "rev", "log"]

# Colonne di sistema con configurazione default
SYSTEM_COLUMN_DEFS = [
    {"name": "TAG", "slug": "tag", "col_type": "text",   "width": 110, "position": 0, "is_system": True},
    {"name": "REV", "slug": "rev", "col_type": "text",   "width": 60,  "position": 1, "is_system": True},
    {"name": "LOG", "slug": "log", "col_type": "log",    "width": 260, "position": 999, "is_system": True},
]


# ============================================================
# UTILITY INTERNE
# ============================================================

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-") or "tool"


def _unique_slug(db: Session, project_id: int, base_slug: str) -> str:
    slug = base_slug
    counter = 1
    while db.query(Tool).filter(
        Tool.project_id == project_id,
        Tool.slug == slug
    ).first():
        counter += 1
        slug = f"{base_slug}-{counter}"
    return slug


def _format_log_entry(rev: str, field: str, old_val, new_val) -> str:
    """Formatta una riga di log leggibile per l'utente."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    old_display = f"'{old_val}'" if old_val else "—"
    new_display = f"'{new_val}'" if new_val else "—"
    return f"[{ts} REV {rev}] {field.upper()}: {old_display} → {new_display}"


def _append_row_log(existing: str, new_entry: str) -> str:
    """Aggiunge una voce in cima al log esistente."""
    if existing:
        return new_entry + "\n" + existing
    return new_entry


def _get_cell_map(db: Session, row_id: int) -> dict:
    """
    Restituisce un dizionario {column_id: ToolCell}
    per una riga, per accesso rapido alle celle.
    """
    cells = db.query(ToolCell).filter(ToolCell.row_id == row_id).all()
    return {c.column_id: c for c in cells}


def _get_column_map(db: Session, tool_id: int) -> dict:
    """
    Restituisce un dizionario {slug: ToolColumn}
    per un tool, per accesso rapido alle colonne.
    """
    columns = db.query(ToolColumn).filter(
        ToolColumn.tool_id == tool_id
    ).all()
    return {c.slug: c for c in columns}


# ============================================================
# SERIALIZZAZIONE — riga → dizionario piatto
# ============================================================

def serialize_row(row: ToolRow, columns: list[ToolColumn]) -> dict:
    """
    Converte una ToolRow + celle in un dizionario piatto
    pronto per essere serializzato come JSON.

    Formato output:
    {
        "id": 1,
        "tool_id": 1,
        "project_id": 1,
        "position": 0,
        "rev": "A",
        "is_deleted": false,
        "row_log": "...",
        "tag": "PT-101",
        "servizio": "Acqua PW",
        ...
    }
    """
    cell_map = {c.column_id: c.value for c in row.cells}

    result = {
        "id":         row.id,
        "tool_id":    row.tool_id,
        "project_id": row.project_id,
        "position":   row.position,
        "rev":        row.rev,
        "is_deleted": row.is_deleted,
        "row_log":    row.row_log,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }

    # Aggiunge i valori delle celle come campi flat
    for col in columns:
        result[col.slug] = cell_map.get(col.id, "")

    return result


# ============================================================
# TOOL — CRUD
# ============================================================

def get_tools_for_project(db: Session, project_id: int) -> list[Tool]:
    """Restituisce tutti i tool di un progetto."""
    return db.query(Tool).filter(
        Tool.project_id == project_id
    ).order_by(Tool.id).all()


def get_tool(db: Session, tool_id: int, project_id: int) -> Tool:
    """Restituisce un tool per id. Solleva 404 se non trovato."""
    tool = db.query(Tool).filter(
        Tool.id == tool_id,
        Tool.project_id == project_id
    ).first()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool non trovato")
    return tool


def create_tool(
    db: Session,
    project_id: int,
    name: str,
    slug: str = None,
    default_columns: list[dict] = None,
    icon: str = None,
    tool_type: str = None
) -> Tool:
    """
    Crea un nuovo tool per il progetto con le colonne di sistema
    e le colonne default fornite.

    Se slug non è fornito viene auto-generato dal nome con suffisso
    numerico per garantire unicità nel progetto.
    """
    if not slug:
        slug = _unique_slug(db, project_id, _slugify(name))

    tool = Tool(
        project_id=project_id,
        name=name,
        slug=slug,
        tool_type=tool_type,
        current_rev="A",
        icon=icon or "📄"
    )
    db.add(tool)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Tool '{slug}' già esistente in questo progetto"
        )

    # Crea colonne di sistema (TAG, REV, LOG)
    for col_def in SYSTEM_COLUMN_DEFS:
        col = ToolColumn(tool_id=tool.id, **col_def)
        db.add(col)

    # Crea colonne default specifiche del tool
    if default_columns:
        for col_def in default_columns:
            col = ToolColumn(tool_id=tool.id, **col_def)
            db.add(col)

    db.commit()
    db.refresh(tool)
    return tool


def update_tool_settings(
    db: Session,
    tool_id: int,
    project_id: int,
    data: dict
) -> Tool:
    """
    Aggiorna le impostazioni di un tool:
    name, current_rev, note, query_config.
    """
    tool = get_tool(db, tool_id, project_id)

    allowed = ["name", "current_rev", "note", "query_config", "icon"]
    for field in allowed:
        if field in data:
            value = data[field]
            # query_config viene salvato come JSON string
            if field == "query_config" and isinstance(value, dict):
                value = json.dumps(value)
            setattr(tool, field, value)

    db.commit()
    db.refresh(tool)
    return tool


# ============================================================
# COLONNE — CRUD
# ============================================================

def get_columns(db: Session, tool_id: int) -> list[ToolColumn]:
    """Restituisce le colonne di un tool ordinate per posizione."""
    return db.query(ToolColumn).filter(
        ToolColumn.tool_id == tool_id
    ).order_by(ToolColumn.position).all()


def add_column(
    db: Session,
    tool_id: int,
    project_id: int,
    name: str,
    slug: str,
    col_type: str = "text",
    width: int = 120,
    position: int = None
) -> ToolColumn:
    """
    Aggiunge una nuova colonna a un tool esistente.
    Se position non è specificato, la aggiunge in fondo
    (prima della colonna LOG di sistema).
    """
    # Verifica che il tool appartenga al progetto
    get_tool(db, tool_id, project_id)

    # Blocca slug di sistema
    if slug.lower() in SYSTEM_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail=f"'{slug}' è una colonna di sistema e non può essere aggiunta"
        )

    # Calcola posizione automatica se non fornita
    if position is None:
        last = db.query(ToolColumn).filter(
            ToolColumn.tool_id == tool_id,
            ToolColumn.is_system == False
        ).order_by(ToolColumn.position.desc()).first()
        position = (last.position + 1) if last else 2

    col = ToolColumn(
        tool_id=tool_id,
        name=name,
        slug=slug,
        col_type=col_type,
        width=width,
        position=position,
        is_system=False
    )
    db.add(col)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Colonna '{slug}' già esistente in questo tool"
        )

    db.commit()
    db.refresh(col)
    return col


def update_column(
    db: Session,
    tool_id: int,
    column_id: int,
    project_id: int,
    data: dict
) -> ToolColumn:
    """
    Aggiorna una colonna esistente.
    Le colonne di sistema non possono essere modificate.
    """
    col = db.query(ToolColumn).filter(
        ToolColumn.id == column_id,
        ToolColumn.tool_id == tool_id
    ).first()

    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")

    if col.is_system:
        raise HTTPException(
            status_code=400,
            detail="Le colonne di sistema non possono essere modificate"
        )

    allowed = ["name", "width", "position", "col_type", "formula"]
    for field in allowed:
        if field in data:
            setattr(col, field, data[field])

    db.commit()
    db.refresh(col)
    return col


def delete_column(
    db: Session,
    tool_id: int,
    column_id: int,
    project_id: int
) -> dict:
    """
    Elimina una colonna e tutte le sue celle.
    Le colonne di sistema non possono essere eliminate.
    """
    col = db.query(ToolColumn).filter(
        ToolColumn.id == column_id,
        ToolColumn.tool_id == tool_id
    ).first()

    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")

    if col.is_system:
        raise HTTPException(
            status_code=400,
            detail="Le colonne di sistema non possono essere eliminate"
        )

    db.delete(col)
    db.commit()
    return {"ok": True, "deleted_id": column_id}


def update_column_width(
    db: Session,
    tool_id: int,
    column_id: int,
    width: int
) -> ToolColumn:
    """
    Aggiorna solo la larghezza di una colonna.
    Chiamata frequente dal frontend durante il resize.
    """
    col = db.query(ToolColumn).filter(
        ToolColumn.id == column_id,
        ToolColumn.tool_id == tool_id
    ).first()

    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")

    col.width = max(40, min(width, 800))  # Clamp tra 40 e 800px
    db.commit()
    db.refresh(col)
    return col


# ============================================================
# RIGHE — CRUD con soft delete
# ============================================================

def get_rows(
    db: Session,
    tool_id: int,
    include_deleted: bool = False
) -> list[dict]:
    """
    Restituisce tutte le righe del tool come dizionari piatti.
    Se include_deleted=False, esclude le righe soft-deleted.
    """
    columns = get_columns(db, tool_id)

    query = db.query(ToolRow).filter(
        ToolRow.tool_id == tool_id
    )

    if not include_deleted:
        query = query.filter(ToolRow.is_deleted == False)

    rows = query.order_by(ToolRow.position.asc()).all()

    return [serialize_row(row, columns) for row in rows]


def create_row(
    db: Session,
    tool_id: int,
    project_id: int,
    cell_data: dict
) -> dict:
    """
    Crea una nuova riga con i valori delle celle forniti.

    cell_data: dizionario {slug_colonna: valore}
    Es: {"tag": "PT-101", "servizio": "Acqua PW"}

    Valida unicità TAG per progetto.
    """
    tool = get_tool(db, tool_id, project_id)
    col_map = _get_column_map(db, tool_id)

    # Validazione TAG obbligatorio
    tag_value = (cell_data.get("tag") or "").strip()
    if not tag_value:
        raise HTTPException(status_code=422, detail="Il campo TAG è obbligatorio")

    # Validazione unicità TAG nel progetto
    _validate_tag_unique(db, tool_id, tag_value)

    # Calcola posizione
    last_row = db.query(ToolRow).filter(
        ToolRow.tool_id == tool_id
    ).order_by(ToolRow.position.desc()).first()
    position = (last_row.position + 1) if last_row else 0

    # Crea la riga
    row = ToolRow(
        tool_id=tool_id,
        project_id=project_id,
        position=position,
        rev=tool.current_rev,
        is_deleted=False
    )
    db.add(row)
    db.flush()

    # Crea le celle
    for slug, value in cell_data.items():
        col = col_map.get(slug)
        if not col:
            continue
        cell = ToolCell(
            row_id=row.id,
            column_id=col.id,
            value=str(value).strip() if value else None
        )
        db.add(cell)

    # Audit log
    write_log(
        db=db,
        project_id=project_id,
        tool=tool.slug,
        action="INSERT",
        row_id=row.id,
        new_value=tag_value
    )

    db.commit()
    db.refresh(row)

    columns = get_columns(db, tool_id)
    return serialize_row(row, columns)


def update_cell(
    db: Session,
    tool_id: int,
    row_id: int,
    project_id: int,
    slug: str,
    new_value: str
) -> dict:
    """
    Aggiorna il valore di una singola cella.

    - Calcola diff e aggiorna row_log
    - Scrive in audit_log
    - Valida unicità TAG se il campo modificato è TAG
    - Marca la cella come is_overridden=True
    """
    tool = get_tool(db, tool_id, project_id)
    col_map = _get_column_map(db, tool_id)

    col = col_map.get(slug)
    if not col:
        raise HTTPException(status_code=404, detail=f"Colonna '{slug}' non trovata")

    # Blocca modifica colonne di sola lettura (REV, LOG)
    if slug in ["rev", "log"]:
        raise HTTPException(
            status_code=400,
            detail=f"La colonna '{slug}' è gestita automaticamente dal sistema"
        )

    row = db.query(ToolRow).filter(
        ToolRow.id == row_id,
        ToolRow.tool_id == tool_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")

    if row.is_deleted:
        raise HTTPException(
            status_code=400,
            detail="Impossibile modificare una riga eliminata"
        )

    # Valore attuale
    cell = db.query(ToolCell).filter(
        ToolCell.row_id == row_id,
        ToolCell.column_id == col.id
    ).first()

    old_value = cell.value if cell else None
    new_value = new_value.strip() if new_value else None

    # Nessuna modifica reale
    if str(old_value or "") == str(new_value or ""):
        columns = get_columns(db, tool_id)
        return serialize_row(row, columns)

    # Validazione TAG
    if slug == "tag":
        if not new_value:
            raise HTTPException(status_code=422, detail="Il TAG non può essere vuoto")
        _validate_tag_unique(db, tool_id, new_value, exclude_row_id=row_id)

    # Aggiorna o crea la cella
    if cell:
        cell.value = new_value
        cell.is_overridden = True
    else:
        cell = ToolCell(
            row_id=row_id,
            column_id=col.id,
            value=new_value,
            is_overridden=True
        )
        db.add(cell)

    # Aggiorna row_log
    log_entry = _format_log_entry(tool.current_rev, slug, old_value, new_value)
    row.row_log = _append_row_log(row.row_log, log_entry)

    # Audit log
    write_log(
        db=db,
        project_id=project_id,
        tool=tool.slug,
        action="UPDATE",
        row_id=row_id,
        field=slug,
        old_value=old_value,
        new_value=new_value
    )

    db.commit()
    db.refresh(row)

    columns = get_columns(db, tool_id)
    return serialize_row(row, columns)


def soft_delete_row(
    db: Session,
    tool_id: int,
    row_id: int,
    project_id: int
) -> dict:
    """
    Soft delete: marca la riga come eliminata senza
    rimuoverla dal DB. Aggiorna row_log con stato REMOVED.
    """
    tool = get_tool(db, tool_id, project_id)

    row = db.query(ToolRow).filter(
        ToolRow.id == row_id,
        ToolRow.tool_id == tool_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")

    row.is_deleted = True
    row.deleted_at = _now()

    # Aggiorna row_log con stato REMOVED
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    log_entry = f"[{ts} REV {tool.current_rev}] REMOVED"
    row.row_log = _append_row_log(row.row_log, log_entry)

    # Audit log
    write_log(
        db=db,
        project_id=project_id,
        tool=tool.slug,
        action="DELETE",
        row_id=row_id,
        old_value=_get_tag_value(db, row_id, tool_id)
    )

    db.commit()
    db.refresh(row)

    columns = get_columns(db, tool_id)
    return serialize_row(row, columns)


def restore_row(
    db: Session,
    tool_id: int,
    row_id: int,
    project_id: int
) -> dict:
    """
    Ripristina una riga soft-deleted.
    Aggiorna row_log con stato RESTORED.
    """
    tool = get_tool(db, tool_id, project_id)

    row = db.query(ToolRow).filter(
        ToolRow.id == row_id,
        ToolRow.tool_id == tool_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")

    row.is_deleted = False
    row.deleted_at = None

    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    log_entry = f"[{ts} REV {tool.current_rev}] RESTORED"
    row.row_log = _append_row_log(row.row_log, log_entry)

    db.commit()
    db.refresh(row)

    columns = get_columns(db, tool_id)
    return serialize_row(row, columns)

def hard_delete_row(
    db: Session,
    tool_id: int,
    row_id: int,
    project_id: int
) -> dict:
    """
    Eliminazione definitiva di una riga dal database.
    Disponibile solo su righe già soft-deleted.
    """
    row = db.query(ToolRow).filter(
        ToolRow.id == row_id,
        ToolRow.tool_id == tool_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")

    if not row.is_deleted:
        raise HTTPException(
            status_code=400,
            detail="La riga deve essere eliminata prima di poter essere rimossa definitivamente"
        )

    # Audit log prima di eliminare
    write_log(
        db=db,
        project_id=project_id,
        tool=db.query(Tool).filter(Tool.id == tool_id).first().slug,
        action="HARD_DELETE",
        row_id=row_id,
        old_value=_get_tag_value(db, row_id, tool_id)
    )

    db.delete(row)
    db.commit()
    return {"ok": True, "deleted_id": row_id}

def paste_rows(
    db: Session,
    tool_id: int,
    project_id: int,
    rows_data: list[dict]
) -> list[dict]:
    """
    Incolla multiple righe in una sola operazione.
    Usato per paste da Excel/CSV.

    rows_data: lista di dizionari {slug: valore}
    Le righe con TAG duplicato vengono saltate con warning.
    """
    tool = get_tool(db, tool_id, project_id)
    col_map = _get_column_map(db, tool_id)
    columns = get_columns(db, tool_id)

    results = []
    skipped = []

    # Posizione di partenza
    last_row = db.query(ToolRow).filter(
        ToolRow.tool_id == tool_id
    ).order_by(ToolRow.position.desc()).first()
    next_position = (last_row.position + 1) if last_row else 0

    for row_data in rows_data:
        tag_value = (row_data.get("tag") or "").strip()

        if not tag_value:
            skipped.append({"reason": "TAG vuoto", "data": row_data})
            continue

        # Controlla unicità TAG
        existing = _find_tag(db, tool_id, tag_value)
        if existing:
            skipped.append({"reason": f"TAG '{tag_value}' già esistente", "data": row_data})
            continue

        row = ToolRow(
            tool_id=tool_id,
            project_id=project_id,
            position=next_position,
            rev=tool.current_rev,
            is_deleted=False
        )
        db.add(row)
        db.flush()

        for slug, value in row_data.items():
            col = col_map.get(slug)
            if not col:
                continue
            cell = ToolCell(
                row_id=row.id,
                column_id=col.id,
                value=str(value).strip() if value else None
            )
            db.add(cell)

        write_log(
            db=db,
            project_id=project_id,
            tool=tool.slug,
            action="INSERT",
            row_id=row.id,
            new_value=tag_value
        )

        next_position += 1
        db.flush()
        results.append(serialize_row(row, columns))

    db.commit()
    return {"inserted": results, "skipped": skipped}


# ============================================================
# UTILITY PRIVATE
# ============================================================

def _validate_tag_unique(
    db: Session,
    tool_id: int,
    tag: str,
    exclude_row_id: int = None
):
    """Solleva 409 se il TAG esiste già nel tool."""
    existing = _find_tag(db, tool_id, tag, exclude_row_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"TAG '{tag}' già esistente in questo tool"
        )


def _find_tag(
    db: Session,
    tool_id: int,
    tag: str,
    exclude_row_id: int = None
):
    """Cerca una riga con un dato TAG nel tool."""
    tag_col = db.query(ToolColumn).filter(
        ToolColumn.tool_id == tool_id,
        ToolColumn.slug == "tag"
    ).first()

    if not tag_col:
        return None

    query = db.query(ToolCell).join(ToolRow).filter(
        ToolRow.tool_id == tool_id,
        ToolCell.column_id == tag_col.id,
        ToolCell.value == tag,
        ToolRow.is_deleted == False
    )

    if exclude_row_id:
        query = query.filter(ToolRow.id != exclude_row_id)

    return query.first()


def _get_tag_value(db: Session, row_id: int, tool_id: int) -> str:
    """Restituisce il valore TAG di una riga."""
    tag_col = db.query(ToolColumn).filter(
        ToolColumn.tool_id == tool_id,
        ToolColumn.slug == "tag"
    ).first()

    if not tag_col:
        return ""

    cell = db.query(ToolCell).filter(
        ToolCell.row_id == row_id,
        ToolCell.column_id == tag_col.id
    ).first()

    return cell.value if cell else ""