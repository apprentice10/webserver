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
from datetime import datetime
from typing import Optional
from fastapi import HTTPException

from engine.project_db import (
    SYSTEM_COLUMNS, SYSTEM_COLUMN_DEFS,
    create_tool_table, add_column_to_table, audit,
    serialize_active_row, serialize_trash_row,
    get_row_overrides, get_tool_overrides,
)
from engine.utils import now_str as _now_str, slugify as _slugify, format_log_entry as _format_log_entry, append_log as _append_log
from engine.staleness import mark_tool_stale, mark_dependents_stale


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
    etl_sql: str = None
) -> dict:
    if not slug:
        slug = _unique_slug(conn, _slugify(name))

    query_config = None
    if template_id:
        tmpl = conn.execute(
            "SELECT * FROM _templates WHERE id = ?", (template_id,)
        ).fetchone()
        if tmpl:
            query_config = json.dumps({"etl_sql": tmpl["etl_sql"], "etl_history": []})
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


def _remove_col_from_model(model: dict, alias: str) -> dict:
    """Remove all output columns matching alias from select/aggregate transformations."""
    for t in model.get("transformations", []):
        if t.get("type") == "select":
            t["columns"] = [c for c in t.get("columns", []) if c.get("alias") != alias]
        elif t.get("type") == "aggregate":
            t["aggregations"] = [c for c in t.get("aggregations", []) if c.get("alias") != alias]
        # compute_column produces a single column — removing it would break the DAG;
        # leave the transformation in place and let the DB column deletion stand alone.
    return model


def _rename_col_in_model(model: dict, old_alias: str, new_alias: str) -> dict:
    """Rename all output columns matching old_alias to new_alias."""
    for t in model.get("transformations", []):
        if t.get("type") in ("select", "aggregate"):
            cols = t.get("columns") or t.get("aggregations") or []
            for c in cols:
                if c.get("alias") == old_alias:
                    c["alias"] = new_alias
        elif t.get("type") == "compute_column":
            col = t.get("column", {})
            if col.get("alias") == old_alias:
                col["alias"] = new_alias
    return model


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

    etl_sql_updated = False

    # Bidirectional ETL: rename alias when an ETL-generated column is renamed
    new_name = data.get("name")
    if new_name and col.get("lineage_info"):
        from engine.utils import slugify

        old_slug = col["slug"]
        new_slug = slugify(new_name)

        if new_slug != old_slug:
            # Reject if new slug collides with an existing column
            clash = conn.execute(
                "SELECT 1 FROM _columns WHERE tool_id=? AND slug=? AND id!=?",
                (tool_id, new_slug, column_id)
            ).fetchone()
            if clash:
                raise HTTPException(status_code=400,
                    detail=f"Una colonna con slug '{new_slug}' esiste già")

            config_row = conn.execute(
                "SELECT query_config FROM _tools WHERE id=?", (tool_id,)
            ).fetchone()
            raw = config_row[0] if config_row else None
            config = json.loads(raw) if raw else {}

            tool_row = conn.execute("SELECT slug FROM _tools WHERE id=?", (tool_id,)).fetchone()
            tool_slug = tool_row[0]

            model = config.get("etl_model")
            if model:
                from engine.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError
                _rename_col_in_model(model, old_slug, new_slug)
                try:
                    new_sql = compile_sql(model)
                except (EtlValidationError, EtlCompilationError):
                    new_sql = config.get("etl_sql", "")
                config["etl_model"] = model
                config["etl_sql"]   = new_sql
                config["etl_deps"]  = [s["name"] for s in model.get("sources", []) if s.get("type") == "table"]
                conn.execute("UPDATE _tools SET query_config=? WHERE id=?", (json.dumps(config), tool_id))
                etl_sql_updated = True
            elif config.get("etl_sql", "").strip():
                from engine.sql_parser import rename_col_in_sql, resolve_etl_deps
                new_sql = rename_col_in_sql(config["etl_sql"], old_slug, new_slug)
                config["etl_sql"]  = new_sql
                config["etl_deps"] = resolve_etl_deps(conn, new_sql)
                conn.execute("UPDATE _tools SET query_config=? WHERE id=?", (json.dumps(config), tool_id))
                etl_sql_updated = True

            # Rename DB column and update all slug references
            conn.execute(
                f'ALTER TABLE "{tool_slug}" RENAME COLUMN "{old_slug}" TO "{new_slug}"'
            )
            sets.append("slug = ?")
            vals.append(new_slug)
            conn.execute(
                "UPDATE _overrides SET col_slug=? WHERE tool_slug=? AND col_slug=?",
                (new_slug, tool_slug, old_slug)
            )

    if sets:
        vals.append(column_id)
        conn.execute(f"UPDATE _columns SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()

    result = dict(conn.execute(
        "SELECT * FROM _columns WHERE id = ?", (column_id,)
    ).fetchone())
    result["etl_sql_updated"] = etl_sql_updated
    return result


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

    sql_was_updated = False
    if col.get("lineage_info"):
        config_row = conn.execute(
            "SELECT query_config FROM _tools WHERE id = ?", (tool_id,)
        ).fetchone()
        raw = config_row[0] if config_row else None
        config = json.loads(raw) if raw else {}

        model = config.get("etl_model")
        if model:
            from engine.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError
            _remove_col_from_model(model, col["slug"])
            try:
                new_sql = compile_sql(model)
            except (EtlValidationError, EtlCompilationError):
                new_sql = config.get("etl_sql", "")
            config["etl_model"] = model
            config["etl_sql"]   = new_sql
            config["etl_deps"]  = [s["name"] for s in model.get("sources", []) if s.get("type") == "table"]
            conn.execute(
                "UPDATE _tools SET query_config = ? WHERE id = ?",
                (json.dumps(config), tool_id)
            )
            sql_was_updated = True
        elif config.get("etl_sql", "").strip():
            from engine.sql_parser import remove_col_from_sql, resolve_etl_deps
            new_sql = remove_col_from_sql(config["etl_sql"], col["slug"])
            config["etl_sql"]  = new_sql
            config["etl_deps"] = resolve_etl_deps(conn, new_sql)
            conn.execute(
                "UPDATE _tools SET query_config = ? WHERE id = ?",
                (json.dumps(config), tool_id)
            )
            sql_was_updated = True

    conn.execute("DELETE FROM _columns WHERE id = ?", (column_id,))
    conn.commit()
    return {"ok": True, "deleted_id": column_id, "etl_sql_updated": sql_was_updated}


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

    # Bulk load all cell flags for this tool: {row_tag: {col_slug: [{id, name, color}]}}
    flag_rows = conn.execute(
        """SELECT cf.row_tag, cf.col_slug, f.id, f.name, f.color
           FROM _cell_flags cf
           JOIN _flags f ON f.id = cf.flag_id
           WHERE cf.tool_slug = ?""",
        (slug,)
    ).fetchall()
    flags_map: dict = {}
    for fr in flag_rows:
        flags_map.setdefault(fr["row_tag"], {}).setdefault(fr["col_slug"], []).append(
            {"id": fr["id"], "name": fr["name"], "color": fr["color"]}
        )

    result = []
    for r in active:
        row = serialize_active_row(r, tool_id, project_id, override_map.get(dict(r).get("tag", ""), {}))
        row["cell_flags"] = flags_map.get(row["tag"], {})
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
    audit(conn, slug, "INSERT", row_tag=tag_value, new_val=tag_value,
          change_type="insert", revision=rev)
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

    audit(conn, tool_slug, "UPDATE", row_tag=tag_val, col_slug=slug,
          old_val=old_value, new_val=new_value, change_type="manual_edit", revision=rev)
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
    audit(conn, slug, "RESTORE", row_tag=tag_val, col_slug=col_slug,
          old_val=row.get(col_slug), new_val=etl_value,
          change_type="restore", revision=tool["rev"])
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

    audit(conn, slug, "DELETE", row_tag=tag_val, change_type="delete", revision=rev)
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
    audit(conn, slug, "RESTORE", row_tag=tag_val, change_type="restore", revision=rev)
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

        audit(conn, slug, "INSERT", row_tag=tag_val, new_val=tag_val,
              change_type="bulk_paste", revision=rev)
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


def rollback_cell(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int,
    col_slug: str,
    entry_id: int
) -> dict:
    tool = get_tool(conn, tool_id)
    tool_slug = tool["slug"]
    rev = tool["rev"]

    if col_slug in ("rev", "log"):
        raise HTTPException(status_code=400, detail="Cannot rollback system column")

    entry = conn.execute(
        "SELECT * FROM _audit WHERE id = ? AND tool_slug = ?",
        (entry_id, tool_slug)
    ).fetchone()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit entry not found")

    row = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    row = dict(row)
    tag_val = row.get("tag", "")
    restore_value = dict(entry)["old_val"]
    current_value = row.get(col_slug)

    conn.execute(
        f'UPDATE "{tool_slug}" SET "{col_slug}" = ? WHERE __id = ?',
        (restore_value, row_id)
    )

    log_entry = _format_log_entry(rev, col_slug, current_value, restore_value)
    new_log = _append_log(row.get("__log"), f"[ROLLBACK] {log_entry}")
    conn.execute(
        f'UPDATE "{tool_slug}" SET __log = ? WHERE __id = ?',
        (new_log, row_id)
    )

    audit(conn, tool_slug, "ROLLBACK", row_tag=tag_val, col_slug=col_slug,
          old_val=current_value, new_val=restore_value, change_type="rollback", revision=rev)
    mark_tool_stale(conn, tool_slug)
    mark_dependents_stale(conn, tool_slug)
    conn.commit()

    updated = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    overrides = get_row_overrides(conn, tool_slug, tag_val)
    return serialize_active_row(updated, tool_id, project_id, overrides)


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
# TEMPLATE — nel per-project DB (sqlite3, tabella _templates)
# ============================================================

def get_templates(
    conn: sqlite3.Connection,
    type_slug: str = None,
) -> list[dict]:
    if type_slug:
        rows = conn.execute(
            "SELECT * FROM _templates WHERE type_slug = ? ORDER BY id DESC",
            (type_slug,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM _templates ORDER BY id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_template(
    conn: sqlite3.Connection,
    type_slug: str,
    name: str,
    etl_sql: str = "",
    description: str = "",
) -> dict:
    cur = conn.execute(
        "INSERT INTO _templates (type_slug, name, etl_sql, description) VALUES (?, ?, ?, ?)",
        (type_slug, name, etl_sql or "", description or ""),
    )
    conn.commit()
    return dict(conn.execute(
        "SELECT * FROM _templates WHERE id = ?", (cur.lastrowid,)
    ).fetchone())


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    row = conn.execute(
        "SELECT id FROM _templates WHERE id = ?", (template_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Template non trovato")
    conn.execute("DELETE FROM _templates WHERE id = ?", (template_id,))
    conn.commit()
