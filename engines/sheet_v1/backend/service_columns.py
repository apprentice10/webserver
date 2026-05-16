"""
engine/service_columns.py
--------------------------
Column CRUD operations for the Table Engine.
Extracted from engine/service.py (P3-005).
"""

import json
import sqlite3
from fastapi import HTTPException

from dashboard.project_db import SYSTEM_COLUMNS, add_column_to_table
from dashboard.utils import slugify as _slugify


def add_column(
    conn: sqlite3.Connection,
    tool_id: int,
    name: str,
    slug: str,
    col_type: str = "text",
    width: int = 120,
    position: int = None
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    tool_slug = tool["slug"]

    if slug.lower() in SYSTEM_COLUMNS:
        raise HTTPException(status_code=400,
            detail=f"'{slug}' is a system column")

    if conn.execute(
        "SELECT 1 FROM _columns WHERE tool_id = ? AND slug = ?", (tool_id, slug)
    ).fetchone():
        raise HTTPException(status_code=409,
            detail=f"Column '{slug}' already exists")

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
        raise HTTPException(status_code=404, detail="Column not found")
    col = dict(col)
    if col["is_system"]:
        raise HTTPException(status_code=400,
            detail="System columns cannot be modified")

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
        old_slug = col["slug"]
        new_slug = _slugify(new_name)

        if new_slug != old_slug:
            clash = conn.execute(
                "SELECT 1 FROM _columns WHERE tool_id=? AND slug=? AND id!=?",
                (tool_id, new_slug, column_id)
            ).fetchone()
            if clash:
                raise HTTPException(status_code=400,
                    detail=f"A column with slug '{new_slug}' already exists")

            config_row = conn.execute(
                "SELECT query_config FROM _tools WHERE id=?", (tool_id,)
            ).fetchone()
            raw = config_row[0] if config_row else None
            config = json.loads(raw) if raw else {}

            tool_row = conn.execute("SELECT slug FROM _tools WHERE id=?", (tool_id,)).fetchone()
            tool_slug = tool_row[0]

            model = config.get("etl_model")
            if model:
                from dashboard.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError
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
                from dashboard.sql_parser import rename_col_in_sql, resolve_etl_deps
                new_sql = rename_col_in_sql(config["etl_sql"], old_slug, new_slug)
                config["etl_sql"]  = new_sql
                config["etl_deps"] = resolve_etl_deps(conn, new_sql)
                conn.execute("UPDATE _tools SET query_config=? WHERE id=?", (json.dumps(config), tool_id))
                etl_sql_updated = True

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
        raise HTTPException(status_code=404, detail="Column not found")
    col = dict(col)
    if col["is_system"]:
        raise HTTPException(status_code=400,
            detail="System columns cannot be deleted")

    sql_was_updated = False
    if col.get("lineage_info"):
        config_row = conn.execute(
            "SELECT query_config FROM _tools WHERE id = ?", (tool_id,)
        ).fetchone()
        raw = config_row[0] if config_row else None
        config = json.loads(raw) if raw else {}

        model = config.get("etl_model")
        if model:
            from dashboard.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError
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
            from dashboard.sql_parser import remove_col_from_sql, resolve_etl_deps
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
    """Reorder user columns (non-system). Positions start at 2."""
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
        raise HTTPException(status_code=404, detail="Column not found")

    width = max(20, width)
    conn.execute("UPDATE _columns SET width = ? WHERE id = ?", (width, column_id))
    conn.commit()
    return dict(conn.execute(
        "SELECT * FROM _columns WHERE id = ?", (column_id,)
    ).fetchone())
