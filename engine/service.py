"""
engine/service.py
------------------
Business logic del Table Engine — flat tables su sqlite3.

Ogni tool è una tabella SQLite nel DB per-progetto.
Colonne interne (prefisso __) non sono visibili all'utente.
Le righe cancellate vivono in _trash (soft delete).
Gli override ETL vivono in _overrides.
"""

import json
import sqlite3
from typing import Optional
from fastapi import HTTPException

from engine.project_db import (
    SYSTEM_COLUMNS, SYSTEM_COLUMN_DEFS,
    create_tool_table, add_column_to_table, audit,
    serialize_active_row, serialize_trash_row,
    get_row_overrides, get_tool_overrides,
)
from engine.models import ToolTemplate
from engine.utils import now_str as _now_str, slugify as _slugify, format_log_entry as _format_log_entry, append_log as _append_log
from sqlalchemy.orm import Session


def _unique_slug(conn: sqlite3.Connection, base_slug: str) -> str:
    slug = base_slug
    counter = 1
    while conn.execute("SELECT 1 FROM _tools WHERE slug = ?", (slug,)).fetchone():
        counter += 1
        slug = f"{base_slug}_{counter}"
    return slug


# ============================================================
# TOOL — CRUD
# ============================================================

def mark_tool_stale(conn: sqlite3.Connection, tool_slug: str) -> None:
    conn.execute("UPDATE _tools SET is_stale = 1 WHERE slug = ?", (tool_slug,))


def mark_dependents_stale(conn: sqlite3.Connection, source_slug: str) -> None:
    """Mark stale all tools whose ETL reads FROM source_slug."""
    tools = conn.execute(
        "SELECT id, query_config FROM _tools WHERE query_config IS NOT NULL"
    ).fetchall()
    for tool in tools:
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            continue
        if source_slug in config.get("etl_deps", []):
            conn.execute("UPDATE _tools SET is_stale = 1 WHERE id = ?", (tool["id"],))


def get_tool(conn: sqlite3.Connection, tool_id: int) -> dict:
    row = conn.execute("SELECT * FROM _tools WHERE id = ?", (tool_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tool non trovato")
    return dict(row)


def get_tools_for_project(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM _tools ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def create_tool(
    conn: sqlite3.Connection,
    name: str,
    slug: str = None,
    tool_type: str = None,
    icon: str = "📄",
    template_id: int = None,
    default_columns: list[dict] = None,
    registry_db: Session = None,
    etl_sql: str = None
) -> dict:
    if not slug:
        slug = _unique_slug(conn, _slugify(name))

    query_config = None
    if template_id and registry_db:
        tmpl = registry_db.query(ToolTemplate).filter(
            ToolTemplate.id == template_id
        ).first()
        if tmpl:
            query_config = json.dumps({"etl_sql": tmpl.etl_sql, "etl_history": []})
    elif etl_sql:
        query_config = json.dumps({"etl_sql": etl_sql, "etl_history": []})

    conn.execute("""
        INSERT INTO _tools (slug, name, tool_type, icon, rev, query_config)
        VALUES (?, ?, ?, ?, 'A', ?)
    """, (slug, name, tool_type, icon or "📄", query_config))

    tool_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Crea la tabella flat del tool
    create_tool_table(conn, slug)

    # Crea colonne di sistema in _columns
    for col_def in SYSTEM_COLUMN_DEFS:
        conn.execute("""
            INSERT INTO _columns (tool_id, tool_slug, slug, name, col_type, width, position, is_system)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (tool_id, slug, col_def["slug"], col_def["name"],
              col_def["col_type"], col_def["width"], col_def["position"], col_def["is_system"]))

    # Colonne default del tipo di tool
    if default_columns:
        for col_def in default_columns:
            conn.execute("""
                INSERT OR IGNORE INTO _columns
                (tool_id, tool_slug, slug, name, col_type, width, position, is_system)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """, (tool_id, slug, col_def["slug"], col_def["name"],
                  col_def.get("col_type", "text"), col_def.get("width", 120),
                  col_def.get("position", 2)))
            add_column_to_table(conn, slug, col_def["slug"])

    conn.commit()
    return get_tool(conn, tool_id)


def update_tool_settings(conn: sqlite3.Connection, tool_id: int, data: dict) -> dict:
    get_tool(conn, tool_id)

    allowed = ["name", "rev", "note", "query_config", "icon"]
    sets = []
    vals = []
    for field in allowed:
        if field in data:
            val = data[field]
            if field == "query_config" and isinstance(val, dict):
                val = json.dumps(val)
            sets.append(f"{field} = ?")
            vals.append(val)

    if sets:
        vals.append(tool_id)
        conn.execute(f"UPDATE _tools SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()

    return get_tool(conn, tool_id)


# ============================================================
# COLONNE — CRUD
# ============================================================

def get_columns(conn: sqlite3.Connection, tool_id: int) -> list[dict]:
    rows = conn.execute("""
        SELECT * FROM _columns WHERE tool_id = ? ORDER BY position, id
    """, (tool_id,)).fetchall()
    return [dict(r) for r in rows]


def add_column(
    conn: sqlite3.Connection,
    tool_id: int,
    name: str,
    slug: str,
    col_type: str = "text",
    width: int = 120,
    position: int = None
) -> dict:
    tool = get_tool(conn, tool_id)
    tool_slug = tool["slug"]

    if slug.lower() in SYSTEM_COLUMNS:
        raise HTTPException(status_code=400,
            detail=f"'{slug}' è una colonna di sistema")

    if conn.execute(
        "SELECT 1 FROM _columns WHERE tool_id = ? AND slug = ?", (tool_id, slug)
    ).fetchone():
        raise HTTPException(status_code=409,
            detail=f"Colonna '{slug}' già esistente")

    if position is None:
        last = conn.execute("""
            SELECT MAX(position) FROM _columns WHERE tool_id = ? AND is_system = 0
        """, (tool_id,)).fetchone()[0]
        position = (last or 1) + 1

    conn.execute("""
        INSERT INTO _columns (tool_id, tool_slug, slug, name, col_type, width, position, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    """, (tool_id, tool_slug, slug, name, col_type, width, position))

    col_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    add_column_to_table(conn, tool_slug, slug)
    conn.commit()

    return dict(conn.execute(
        "SELECT * FROM _columns WHERE id = ?", (col_id,)
    ).fetchone())


def update_column(conn: sqlite3.Connection, tool_id: int, column_id: int, data: dict) -> dict:
    col = conn.execute(
        "SELECT * FROM _columns WHERE id = ? AND tool_id = ?", (column_id, tool_id)
    ).fetchone()
    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")
    col = dict(col)
    if col["is_system"]:
        raise HTTPException(status_code=400,
            detail="Le colonne di sistema non possono essere modificate")

    allowed = ["name", "width", "position", "col_type", "formula"]
    sets = []
    vals = []
    for field in allowed:
        if field in data:
            sets.append(f"{field} = ?")
            vals.append(data[field])

    if sets:
        vals.append(column_id)
        conn.execute(f"UPDATE _columns SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()

    return dict(conn.execute(
        "SELECT * FROM _columns WHERE id = ?", (column_id,)
    ).fetchone())


def delete_column(conn: sqlite3.Connection, tool_id: int, column_id: int) -> dict:
    col = conn.execute(
        "SELECT * FROM _columns WHERE id = ? AND tool_id = ?", (column_id, tool_id)
    ).fetchone()
    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")
    col = dict(col)
    if col["is_system"]:
        raise HTTPException(status_code=400,
            detail="Le colonne di sistema non possono essere eliminate")

    conn.execute("DELETE FROM _columns WHERE id = ?", (column_id,))
    conn.commit()
    return {"ok": True, "deleted_id": column_id}


def reorder_columns(conn: sqlite3.Connection, tool_id: int, col_ids: list[int]) -> dict:
    """Riordina le colonne utente (non system). Posizioni partono da 2."""
    for i, col_id in enumerate(col_ids):
        conn.execute(
            "UPDATE _columns SET position = ? WHERE id = ? AND tool_id = ? AND is_system = 0",
            (i + 2, col_id, tool_id)
        )
    conn.commit()
    return {"ok": True, "reordered": len(col_ids)}


def update_column_width(conn: sqlite3.Connection, tool_id: int, column_id: int, width: int) -> dict:
    col = conn.execute(
        "SELECT * FROM _columns WHERE id = ? AND tool_id = ?", (column_id, tool_id)
    ).fetchone()
    if not col:
        raise HTTPException(status_code=404, detail="Colonna non trovata")

    width = max(40, min(width, 800))
    conn.execute("UPDATE _columns SET width = ? WHERE id = ?", (width, column_id))
    conn.commit()
    return dict(conn.execute(
        "SELECT * FROM _columns WHERE id = ?", (column_id,)
    ).fetchone())


# ============================================================
# RIGHE — CRUD con trash
# ============================================================

def get_rows(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    include_deleted: bool = False
) -> list[dict]:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]

    active = conn.execute(
        f'SELECT * FROM "{slug}" ORDER BY __position ASC'
    ).fetchall()
    override_map = get_tool_overrides(conn, slug)
    result = [
        serialize_active_row(r, tool_id, project_id, override_map.get(dict(r).get("tag", ""), {}))
        for r in active
    ]

    if include_deleted:
        trash = conn.execute(
            "SELECT * FROM _trash WHERE tool_slug = ? ORDER BY deleted_at DESC",
            (slug,)
        ).fetchall()
        result += [serialize_trash_row(r, tool_id, project_id) for r in trash]

    return result


def create_row(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    cell_data: dict
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]
    rev  = tool["rev"]

    tag_value = (cell_data.get("tag") or "").strip()
    if not tag_value:
        raise HTTPException(status_code=422, detail="Il campo TAG è obbligatorio")

    _validate_tag_unique(conn, slug, tag_value)

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    # Colonne valide (escludi system read-only)
    valid_cols = {c["slug"] for c in get_columns(conn, tool_id)
                  if c["slug"] not in ("log",)}

    insert_data = {"tag": tag_value, "rev": rev, "__position": next_pos}
    for k, v in cell_data.items():
        if k in valid_cols and k not in ("rev",):
            insert_data[k] = str(v).strip() if v is not None else None

    cols_str = ", ".join(f'"{c}"' for c in insert_data)
    placeholders = ", ".join("?" * len(insert_data))
    conn.execute(
        f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
        list(insert_data.values())
    )

    row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    audit(conn, slug, "INSERT", row_tag=tag_value, new_val=tag_value)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
    return serialize_active_row(row, tool_id, project_id)


def update_cell(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int,
    slug: str,
    new_value: str
) -> dict:
    tool = get_tool(conn, tool_id)
    tool_slug = tool["slug"]
    rev = tool["rev"]

    if slug in ("rev", "log"):
        raise HTTPException(status_code=400,
            detail=f"'{slug}' è gestita automaticamente dal sistema")

    if not conn.execute(
        "SELECT 1 FROM _columns WHERE tool_id = ? AND slug = ?", (tool_id, slug)
    ).fetchone():
        raise HTTPException(status_code=404, detail=f"Colonna '{slug}' non trovata")

    row = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")
    row = dict(row)

    old_value = row.get(slug)
    new_value = new_value.strip() if new_value else None

    if str(old_value or "") == str(new_value or ""):
        return serialize_active_row(
            conn.execute(f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)).fetchone(),
            tool_id, project_id
        )

    if slug == "tag":
        if not new_value:
            raise HTTPException(status_code=422, detail="Il TAG non può essere vuoto")
        _validate_tag_unique(conn, tool_slug, new_value, exclude_id=row_id)

    # Aggiorna valore
    conn.execute(
        f'UPDATE "{tool_slug}" SET "{slug}" = ? WHERE __id = ?',
        (new_value, row_id)
    )

    # Override — etl_value salvato solo al primo insert (OR IGNORE preserva il valore originale)
    tag_val = row.get("tag", "")
    conn.execute(
        "INSERT OR IGNORE INTO _overrides (tool_slug, row_tag, col_slug, etl_value) VALUES (?,?,?,?)",
        (tool_slug, tag_val, slug, str(old_value) if old_value is not None else None)
    )

    # Row log
    log_entry = _format_log_entry(rev, slug, old_value, new_value)
    existing_log = row.get("__log")
    new_log = _append_log(existing_log, log_entry)
    conn.execute(
        f'UPDATE "{tool_slug}" SET __log = ? WHERE __id = ?',
        (new_log, row_id)
    )

    # Se TAG cambia, aggiorna _overrides con nuovo tag
    if slug == "tag" and new_value and old_value:
        conn.execute(
            "UPDATE _overrides SET row_tag = ? WHERE tool_slug = ? AND row_tag = ?",
            (new_value, tool_slug, old_value)
        )

    audit(conn, tool_slug, "UPDATE", row_tag=tag_val, field=slug,
          old_val=old_value, new_val=new_value)
    mark_tool_stale(conn, tool_slug)
    mark_dependents_stale(conn, tool_slug)
    conn.commit()

    updated = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    tag_after = dict(updated).get("tag", tag_val)
    overrides = get_row_overrides(conn, tool_slug, tag_after)
    return serialize_active_row(updated, tool_id, project_id, overrides)


def remove_override(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    col_slug: str,
    project_id: int
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]

    row = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")
    row = dict(row)

    tag_val = row.get("tag", "")
    override = conn.execute(
        "SELECT etl_value FROM _overrides WHERE tool_slug = ? AND row_tag = ? AND col_slug = ?",
        (slug, tag_val, col_slug)
    ).fetchone()
    if not override:
        raise HTTPException(status_code=404, detail="Nessun override trovato per questa cella")

    etl_value = override["etl_value"]
    conn.execute(
        f'UPDATE "{slug}" SET "{col_slug}" = ? WHERE __id = ?',
        (etl_value, row_id)
    )
    conn.execute(
        "DELETE FROM _overrides WHERE tool_slug = ? AND row_tag = ? AND col_slug = ?",
        (slug, tag_val, col_slug)
    )
    conn.commit()

    updated = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    overrides = get_row_overrides(conn, slug, tag_val)
    return serialize_active_row(updated, tool_id, project_id, overrides)


def soft_delete_row(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]
    rev  = tool["rev"]

    row = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Riga non trovata")
    row = dict(row)

    tag_val = row.get("tag", "")
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    log_entry = _append_log(row.get("__log"), f"[{ts} REV {rev}] REMOVED")

    # Serializza riga (solo campi utente + tag + rev)
    row_data = {k: v for k, v in row.items() if not k.startswith("__")}
    orig_pos = row.get("__position", 0)

    conn.execute(
        "INSERT INTO _trash (tool_slug, orig_pos, row_data, row_log) VALUES (?,?,?,?)",
        (slug, orig_pos, json.dumps(row_data), log_entry)
    )
    trash_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute(f'DELETE FROM "{slug}" WHERE __id = ?', (row_id,))

    audit(conn, slug, "DELETE", row_tag=tag_val)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    trash_row = conn.execute(
        "SELECT * FROM _trash WHERE id = ?", (trash_id,)
    ).fetchone()
    return serialize_trash_row(trash_row, tool_id, project_id)


def restore_row(
    conn: sqlite3.Connection,
    tool_id: int,
    trash_id: int,
    project_id: int
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]
    rev  = tool["rev"]

    trash = conn.execute(
        "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
    ).fetchone()
    if not trash:
        raise HTTPException(status_code=404, detail="Riga nel cestino non trovata")
    trash = dict(trash)

    try:
        row_data = json.loads(trash["row_data"])
    except Exception:
        row_data = {}

    tag_val = row_data.get("tag", "")
    _validate_tag_unique(conn, slug, tag_val)

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    new_log = _append_log(trash.get("row_log"), f"[{ts} REV {rev}] RESTORED")

    # Ri-inserisce (senza le colonne interne)
    safe_data = {k: v for k, v in row_data.items()
                 if not k.startswith("__") and k != "log"}
    safe_data["__position"] = next_pos
    safe_data["__log"] = new_log

    cols_str = ", ".join(f'"{c}"' for c in safe_data)
    placeholders = ", ".join("?" * len(safe_data))
    conn.execute(
        f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
        list(safe_data.values())
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)).fetchone()
    return serialize_active_row(row, tool_id, project_id)


def hard_delete_row(
    conn: sqlite3.Connection,
    tool_id: int,
    trash_id: int,
    project_id: int
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]

    trash = conn.execute(
        "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
    ).fetchone()
    if not trash:
        raise HTTPException(status_code=404, detail="Riga nel cestino non trovata")

    conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
    conn.commit()
    return {"ok": True, "deleted_id": trash_id}


def paste_rows(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    rows_data: list[dict]
) -> dict:
    tool = get_tool(conn, tool_id)
    slug = tool["slug"]
    rev  = tool["rev"]

    valid_cols = {c["slug"] for c in get_columns(conn, tool_id)
                  if c["slug"] not in ("log",)}

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    inserted = []
    skipped  = []

    for row_data in rows_data:
        tag_val = (row_data.get("tag") or "").strip()
        if not tag_val:
            skipped.append({"reason": "TAG vuoto", "data": row_data})
            continue

        if conn.execute(
            f'SELECT 1 FROM "{slug}" WHERE tag = ?', (tag_val,)
        ).fetchone():
            skipped.append({"reason": f"TAG '{tag_val}' già esistente", "data": row_data})
            continue

        insert_data = {"tag": tag_val, "rev": rev, "__position": next_pos}
        for k, v in row_data.items():
            if k in valid_cols and k not in ("tag", "rev"):
                insert_data[k] = str(v).strip() if v is not None else None

        cols_str = ", ".join(f'"{c}"' for c in insert_data)
        placeholders = ", ".join("?" * len(insert_data))
        conn.execute(
            f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
            list(insert_data.values())
        )
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        audit(conn, slug, "INSERT", row_tag=tag_val, new_val=tag_val)
        next_pos += 1

        row = conn.execute(
            f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)
        ).fetchone()
        inserted.append(serialize_active_row(row, tool_id, project_id))

    if inserted:
        mark_tool_stale(conn, slug)
        mark_dependents_stale(conn, slug)
    conn.commit()
    return {"inserted": inserted, "skipped": skipped}


# ============================================================
# UTILITY PRIVATE
# ============================================================

def _validate_tag_unique(
    conn: sqlite3.Connection,
    tool_slug: str,
    tag: str,
    exclude_id: int = None
):
    query = f'SELECT __id FROM "{tool_slug}" WHERE tag = ?'
    args  = [tag]
    if exclude_id is not None:
        query += " AND __id != ?"
        args.append(exclude_id)
    if conn.execute(query, args).fetchone():
        raise HTTPException(status_code=409,
            detail=f"TAG '{tag}' già esistente in questo tool")


# ============================================================
# TEMPLATE — nel registry DB (SQLAlchemy)
# ============================================================

def get_templates(
    registry_db: Session,
    type_slug: str = None,
    tool_id: int = None,
    project_id: int = None
) -> list[ToolTemplate]:
    q = registry_db.query(ToolTemplate)
    if tool_id:
        q = q.filter(ToolTemplate.tool_id == tool_id)
    elif project_id and type_slug:
        q = q.filter(ToolTemplate.project_id == project_id,
                     ToolTemplate.type_slug == type_slug)
    elif type_slug:
        q = q.filter(ToolTemplate.type_slug == type_slug)
    return q.order_by(ToolTemplate.created_at.desc()).all()


def create_template(
    registry_db: Session,
    type_slug: str,
    name: str,
    etl_sql: str,
    description: str = None,
    project_id: int = None,
    tool_id: int = None
) -> ToolTemplate:
    t = ToolTemplate(
        type_slug=type_slug,
        name=name,
        description=description,
        etl_sql=etl_sql,
        project_id=project_id,
        tool_id=tool_id
    )
    registry_db.add(t)
    registry_db.commit()
    registry_db.refresh(t)
    return t


def delete_template(registry_db: Session, template_id: int) -> None:
    t = registry_db.query(ToolTemplate).filter(ToolTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template non trovato")
    registry_db.delete(t)
    registry_db.commit()
