"""
engine/service.py
------------------
Business logic del Table Engine — flat tables su sqlite3.

Ogni tool è una tabella SQLite nel DB per-progetto.
Colonne interne (prefisso __) non sono visibili all'utente.
Le righe cancellate vivono in _trash (soft delete).
Gli override ETL vivono in _overrides.
"""

import fnmatch
import json
import sqlite3
from fastapi import HTTPException

from dashboard.project_db import (
    SYSTEM_COLUMN_DEFS,
    create_tool_table, add_column_to_table, audit,
    serialize_active_row, serialize_trash_row,
    get_row_overrides, get_tool_overrides, get_current_revision,
)
from dashboard.utils import slugify as _slugify, format_log_entry as _format_log_entry, append_log as _append_log
from dashboard.staleness import mark_tool_stale, mark_dependents_stale
from dashboard.catalog import ENGINE_BY_SLUG
from .service_undo import push_undo


def _unique_slug(conn: sqlite3.Connection, base_slug: str) -> str:
    slug = base_slug
    counter = 1
    while conn.execute("SELECT 1 FROM _tools WHERE slug = ?", (slug,)).fetchone():
        counter += 1
        slug = f"{base_slug}_{counter}"
    return slug


# ============================================================
# ENGINE — CRUD
# ============================================================

def get_engine(conn: sqlite3.Connection, tool_id: int) -> dict:
    row = conn.execute("SELECT * FROM _tools WHERE id = ?", (tool_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Engine not found")
    return dict(row)


def get_engines_for_project(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM _tools WHERE is_trashed = 0 OR is_trashed IS NULL ORDER BY position, id"
    ).fetchall()
    return [dict(r) for r in rows]


def create_engine(
    conn: sqlite3.Connection,
    name: str,
    slug: str = None,
    tool_type: str = None,
    engine_version: str = None,
    icon: str = "📄",
    template_id: int = None,
    default_columns: list[dict] = None,
    etl_sql: str = None
) -> dict:
    if not slug:
        slug = _unique_slug(conn, _slugify(name))

    # Resolve version from catalog if not supplied explicitly
    if not engine_version and tool_type:
        manifest = ENGINE_BY_SLUG.get(tool_type)
        if manifest:
            engine_version = manifest.get("version", "1.0")
    if not engine_version:
        engine_version = "1.0"

    query_config = None
    if template_id:
        tmpl = conn.execute(
            "SELECT * FROM _templates WHERE id = ?", (template_id,)
        ).fetchone()
        if tmpl:
            query_config = json.dumps({"etl_sql": tmpl["etl_sql"], "etl_history": []})
    elif etl_sql:
        query_config = json.dumps({"etl_sql": etl_sql, "etl_history": []})

    max_pos = conn.execute("SELECT COALESCE(MAX(position), -1) FROM _tools").fetchone()[0]
    next_pos = max_pos + 1

    conn.execute("""
        INSERT INTO _tools (slug, name, tool_type, engine_version, icon, rev, query_config, position)
        VALUES (?, ?, ?, ?, ?, 'A', ?, ?)
    """, (slug, name, tool_type, engine_version, icon or "📄", query_config, next_pos))

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
    return get_engine(conn, tool_id)


def update_engine_settings(conn: sqlite3.Connection, tool_id: int, data: dict) -> dict:
    get_engine(conn, tool_id)

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

    return get_engine(conn, tool_id)


# ============================================================
# COLONNE — CRUD
# ============================================================

def get_columns(conn: sqlite3.Connection, tool_id: int) -> list[dict]:
    rows = conn.execute("""
        SELECT * FROM _columns WHERE tool_id = ? ORDER BY position, id
    """, (tool_id,)).fetchall()
    return [dict(r) for r in rows]


# ============================================================
# RIGHE — CRUD con trash
# ============================================================

def _eval_conditional_rule(cell_value, operator: str, rule_value: str) -> bool:
    v = str(cell_value) if cell_value is not None else ""
    if operator == "equals":           return v == rule_value
    if operator == "contains":         return rule_value.lower() in v.lower()
    if operator == "is_empty":         return v.strip() == ""
    if operator == "starts_with":      return v.lower().startswith(rule_value.lower())
    if operator == "matches_wildcard": return fnmatch.fnmatch(v.lower(), rule_value.lower())
    return False

def _get_row_cell_flags(conn: sqlite3.Connection, tool_slug: str, row_tag: str, row_values: dict) -> dict:
    manual = conn.execute(
        "SELECT cf.col_slug, f.id, f.name, f.color, cf.note FROM _cell_flags cf "
        "JOIN _flags f ON f.id = cf.flag_id WHERE cf.tool_slug=? AND cf.row_tag=?",
        (tool_slug, row_tag)).fetchall()
    flags_map: dict = {}
    for r in manual:
        flags_map.setdefault(r["col_slug"], []).append(
            {"id": r["id"], "name": r["name"], "color": r["color"], "note": r["note"]})
    for r in conn.execute(
        "SELECT r.col_slug, r.operator, r.value, f.id, f.name, f.color FROM _conditional_flag_rules r "
        "JOIN _flags f ON f.id = r.flag_id WHERE r.tool_slug=?", (tool_slug,)).fetchall():
        if _eval_conditional_rule(row_values.get(r["col_slug"], ""), r["operator"], r["value"]):
            col_flags = flags_map.setdefault(r["col_slug"], [])
            if not any(f["id"] == r["id"] for f in col_flags):
                col_flags.append({"id": r["id"], "name": r["name"], "color": r["color"], "note": ""})
    return flags_map

def get_rows(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    include_deleted: bool = False
) -> list[dict]:
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]

    active = conn.execute(
        f'SELECT * FROM "{slug}" ORDER BY __position ASC'
    ).fetchall()
    override_map = get_tool_overrides(conn, slug)

    # Bulk load manual cell flags: {row_tag: {col_slug: [{id, name, color, note}]}}
    flag_rows = conn.execute(
        """SELECT cf.row_tag, cf.col_slug, f.id, f.name, f.color, cf.note
           FROM _cell_flags cf
           JOIN _flags f ON f.id = cf.flag_id
           WHERE cf.tool_slug = ?""",
        (slug,)
    ).fetchall()
    flags_map: dict = {}
    for fr in flag_rows:
        flags_map.setdefault(fr["row_tag"], {}).setdefault(fr["col_slug"], []).append(
            {"id": fr["id"], "name": fr["name"], "color": fr["color"], "note": fr["note"]}
        )

    # Bulk load conditional rules for evaluation
    cond_rules = conn.execute(
        """SELECT r.col_slug, r.operator, r.value, f.id, f.name, f.color
           FROM _conditional_flag_rules r JOIN _flags f ON f.id = r.flag_id
           WHERE r.tool_slug = ?""",
        (slug,)
    ).fetchall()

    result = []
    for r in active:
        row = serialize_active_row(r, tool_id, project_id, override_map.get(dict(r).get("tag", ""), {}))
        row["cell_flags"] = flags_map.get(row["tag"], {})
        for cr in cond_rules:
            if _eval_conditional_rule(row.get(cr["col_slug"], ""), cr["operator"], cr["value"]):
                col_flags = row["cell_flags"].setdefault(cr["col_slug"], [])
                if not any(f["id"] == cr["id"] for f in col_flags):
                    col_flags.append({"id": cr["id"], "name": cr["name"], "color": cr["color"], "note": ""})
        result.append(row)

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
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

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
    audit(conn, slug, "INSERT", row_tag=tag_value, new_val=json.dumps(insert_data),
          change_type="insert", revision=rev)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
    row_snapshot = {k: v for k, v in dict(row).items() if not k.startswith("__")}
    push_undo(tool_id, {
        "type": "row_insert", "tool_slug": slug, "tool_id": tool_id,
        "row_id": row_id, "row_tag": tag_value, "row_snapshot": row_snapshot,
    })
    return serialize_active_row(row, tool_id, project_id)


def update_cell(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int,
    slug: str,
    new_value: str
) -> dict:
    tool = get_engine(conn, tool_id)
    tool_slug = tool["slug"]
    rev = get_current_revision(conn)

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

    # Aggiorna valore e marca la riga con la revisione corrente
    conn.execute(
        f'UPDATE "{tool_slug}" SET "{slug}" = ?, rev = ? WHERE __id = ?',
        (new_value, rev, row_id)
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

    audit(conn, tool_slug, "UPDATE", row_tag=tag_val, col_slug=slug,
          old_val=old_value, new_val=new_value, change_type="manual_edit", revision=rev)
    mark_tool_stale(conn, tool_slug)
    mark_dependents_stale(conn, tool_slug)
    conn.commit()

    push_undo(tool_id, {
        "type": "cell_edit", "tool_slug": tool_slug, "tool_id": tool_id,
        "row_id": row_id, "col_slug": slug,
        "old_val": old_value, "new_val": new_value, "row_tag": tag_val,
    })

    updated = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    tag_after = dict(updated).get("tag", tag_val)
    overrides = get_row_overrides(conn, tool_slug, tag_after)
    result_row = serialize_active_row(updated, tool_id, project_id, overrides)
    result_row["cell_flags"] = _get_row_cell_flags(conn, tool_slug, tag_after, result_row)
    return result_row




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
            detail=f"TAG '{tag}' already exists in this engine")
