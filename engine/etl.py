"""
engine/etl.py
-------------
Model-first ETL engine.

SQL is always compiled from the EtlModel — never stored as source of truth.
sql_parser is no longer used at runtime; deps and lineage are derived from
the model structure directly.
"""

import json
import sqlite3
from datetime import datetime, timezone

from fastapi import HTTPException

from engine.project_db import add_column_to_table, audit, SYSTEM_COLUMN_DEFS
from engine.service import get_tool, get_columns
from engine.etl_compiler import (
    compile_sql,
    EtlValidationError,
    EtlCompilationError,
    expr_to_sql,
)


SYSTEM_SLUGS = {"tag", "rev", "log"}
INTERNAL_COLS = {"__id", "__position", "__log", "__created_at"}


# ============================================================
# INTERNAL HELPERS
# ============================================================

def _run_sql_preview(conn: sqlite3.Connection, sql: str) -> dict:
    """Execute a compiled SQL string and return preview rows + warnings."""
    _check_sql_safety(sql)
    try:
        cur = conn.execute(sql)
        columns = [d[0].lower() for d in cur.description]
        rows    = [dict(zip(columns, row)) for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL error: {e}")

    warnings = []
    if "tag" not in columns:
        warnings.append("Query does not include 'tag' — required for row merge.")

    return {
        "columns":   columns,
        "rows":      rows,
        "row_count": len(rows),
        "warnings":  warnings,
    }


def _compile(model: dict) -> str:
    """Compile a model dict to SQL; raise HTTP 422 on validation/compile error."""
    try:
        return compile_sql(model)
    except EtlValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except EtlCompilationError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _etl_deps_from_model(model: dict) -> list[str]:
    """Return tool slugs referenced as table sources in the model."""
    return [
        s["name"]
        for s in model.get("sources", [])
        if s.get("type") == "table"
    ]


def _extract_model_lineage(model: dict) -> dict:
    """
    Build {col_alias: {"source_expr": str, "from_tool": str|None}} from the
    model's SELECT / AGGREGATE / COMPUTE_COLUMN transformations.

    Replaces runtime calls to sql_parser._extract_col_lineage and
    sql_parser._lineage_to_source — no SQL string inspection.
    """
    source_by_alias = {
        s.get("alias", ""): s.get("name", "")
        for s in model.get("sources", [])
        if s.get("type") == "table" and s.get("alias")
    }

    lineage: dict = {}
    for tr in model.get("transformations", []):
        tr_type = tr.get("type", "")

        if tr_type == "select":
            cols = tr.get("columns", [])
        elif tr_type == "aggregate":
            cols = tr.get("aggregations", [])
        elif tr_type == "compute_column":
            col = tr.get("column")
            cols = [col] if col else []
        else:
            continue

        for col in cols:
            alias = col.get("alias", "")
            if not alias:
                continue
            expr = col.get("expr", {})
            source_expr = expr_to_sql(expr)
            from_tool = None
            if expr.get("type") == "column_ref":
                ta = expr.get("table_alias", "")
                if ta:
                    from_tool = source_by_alias.get(ta)
            lineage[alias] = {"source_expr": source_expr, "from_tool": from_tool}

    return lineage


def _load_config(tool: dict) -> dict:
    try:
        return json.loads(tool["query_config"]) if tool.get("query_config") else {}
    except Exception:
        return {}


# ============================================================
# PREVIEW
# ============================================================

def etl_preview(conn: sqlite3.Connection, tool_id: int, model: dict) -> dict:
    get_tool(conn, tool_id)
    sql = _compile(model)
    return _run_sql_preview(conn, sql)


# ============================================================
# APPLY
# ============================================================

def etl_apply(conn: sqlite3.Connection, tool_id: int, model: dict) -> dict:
    tool    = get_tool(conn, tool_id)
    slug    = tool["slug"]
    rev     = tool["rev"]

    # Compile SQL once — used for execution and persistence
    sql     = _compile(model)
    preview = _run_sql_preview(conn, sql)
    etl_rows = preview["rows"]
    etl_cols = [c for c in preview["columns"] if c != "log"]

    # Lineage derived from model structure — no SQL parsing
    lineage_map = _extract_model_lineage(model)

    # --------------------------------------------------------
    # Create missing columns + update lineage_info
    # --------------------------------------------------------
    existing_slugs = {c["slug"] for c in get_columns(conn, tool_id)}
    cols_created   = 0

    for col_slug in etl_cols:
        if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
            continue

        lineage_data = lineage_map.get(col_slug)
        lineage_json = json.dumps(lineage_data) if lineage_data else None

        if col_slug not in existing_slugs:
            last_pos = conn.execute("""
                SELECT MAX(position) FROM _columns
                WHERE tool_id = ? AND is_system = 0
            """, (tool_id,)).fetchone()[0]
            new_pos = (last_pos or 1) + 1

            conn.execute("""
                INSERT INTO _columns
                    (tool_id, tool_slug, slug, name, col_type, width, position, is_system, lineage_info)
                VALUES (?, ?, ?, ?, 'text', 120, ?, 0, ?)
            """, (tool_id, slug, col_slug,
                  col_slug.upper().replace("_", " "), new_pos, lineage_json))

            add_column_to_table(conn, slug, col_slug)
            cols_created += 1

        elif lineage_json is not None:
            conn.execute("""
                UPDATE _columns SET lineage_info = ?
                WHERE tool_slug = ? AND slug = ?
            """, (lineage_json, slug, col_slug))

    # --------------------------------------------------------
    # Merge rows (upsert by tag)
    # --------------------------------------------------------
    created = 0
    updated = 0
    skipped = 0
    errors  = []

    max_pos  = conn.execute(f'SELECT MAX(__position) FROM "{slug}"').fetchone()[0]
    next_pos = (max_pos or -1) + 1

    for etl_row in etl_rows:
        tag_val = str(etl_row.get("tag", "")).strip()
        if not tag_val:
            errors.append("Row without TAG — skipped")
            continue

        try:
            existing = conn.execute(
                f'SELECT __id FROM "{slug}" WHERE tag = ?', (tag_val,)
            ).fetchone()

            if existing:
                row_id  = existing[0]
                cur_row = dict(conn.execute(
                    f'SELECT * FROM "{slug}" WHERE __id=?', (row_id,)
                ).fetchone())
                for col_slug, val in etl_row.items():
                    if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
                        continue
                    override = conn.execute("""
                        SELECT 1 FROM _overrides
                        WHERE tool_slug=? AND row_tag=? AND col_slug=?
                    """, (slug, tag_val, col_slug)).fetchone()

                    if override:
                        skipped += 1
                        continue

                    str_val = str(val).strip() if val is not None else None
                    old_val = cur_row.get(col_slug)
                    if str(old_val or "") != str(str_val or ""):
                        conn.execute(
                            f'UPDATE "{slug}" SET "{col_slug}"=? WHERE __id=?',
                            (str_val, row_id)
                        )
                        audit(conn, slug, "UPDATE", row_tag=tag_val,
                              col_slug=col_slug, old_val=old_val,
                              new_val=str_val, change_type="etl_update")
                updated += 1

            else:
                insert_data = {"tag": tag_val, "rev": rev, "__position": next_pos}
                for col_slug, val in etl_row.items():
                    if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
                        continue
                    insert_data[col_slug] = str(val).strip() if val is not None else None

                cols_str     = ", ".join(f'"{c}"' for c in insert_data)
                placeholders = ", ".join("?" * len(insert_data))
                conn.execute(
                    f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
                    list(insert_data.values())
                )
                audit(conn, slug, "ETL_INSERT", row_tag=tag_val,
                      new_val=tag_val, change_type="etl_insert")
                next_pos += 1
                created  += 1

        except Exception as e:
            errors.append(f"TAG '{tag_val}': {e}")

    # --------------------------------------------------------
    # Flag orphan rows (in DB but missing from ETL result)
    # --------------------------------------------------------
    elim_flag = conn.execute(
        "SELECT id FROM _flags WHERE name = 'ETL: Eliminated'"
    ).fetchone()

    orphaned = 0
    if elim_flag:
        flag_id  = elim_flag[0]
        etl_tags = {str(r.get("tag", "")).strip() for r in etl_rows}
        etl_tags.discard("")
        all_tags = {
            r[0] for r in conn.execute(f'SELECT tag FROM "{slug}"').fetchall() if r[0]
        }
        for tag in all_tags - etl_tags:
            conn.execute(
                "INSERT OR IGNORE INTO _cell_flags "
                "(tool_slug, row_tag, col_slug, flag_id) VALUES (?,?,?,?)",
                (slug, tag, "", flag_id)
            )
            audit(conn, slug, "ETL_ELIMINATED", row_tag=tag,
                  change_type="etl_eliminated")
            orphaned += 1

        if etl_tags:
            placeholders = ",".join("?" * len(etl_tags))
            conn.execute(
                f"DELETE FROM _cell_flags "
                f"WHERE tool_slug=? AND col_slug='' AND flag_id=? "
                f"AND row_tag IN ({placeholders})",
                [slug, flag_id] + list(etl_tags)
            )

    # --------------------------------------------------------
    # Persist model + compiled SQL + deps
    # --------------------------------------------------------
    row = conn.execute("SELECT query_config FROM _tools WHERE id=?", (tool_id,)).fetchone()
    cfg = json.loads(row[0]) if row and row[0] else {}
    cfg["etl_model"] = model
    cfg["etl_sql"]   = sql
    cfg["etl_deps"]  = _etl_deps_from_model(model)
    conn.execute("UPDATE _tools SET query_config=? WHERE id=?",
                 (json.dumps(cfg), tool_id))

    conn.commit()

    return {
        "columns_created": cols_created,
        "created":         created,
        "updated":         updated,
        "skipped_cells":   skipped,
        "orphaned":        orphaned,
        "errors":          errors,
    }


# ============================================================
# RUN SAVED
# ============================================================

def etl_run_saved(
    conn: sqlite3.Connection,
    tool_id: int,
    _visited: set = None,
) -> dict:
    if _visited is None:
        _visited = set()

    tool      = get_tool(conn, tool_id)
    tool_slug = tool["slug"]

    if tool_slug in _visited:
        raise HTTPException(
            status_code=400,
            detail=f"Circular ETL dependency detected: '{tool_slug}'"
        )
    _visited.add(tool_slug)

    config = get_etl_config(conn, tool_id)
    model  = config.get("etl_model")
    if not model:
        raise HTTPException(
            status_code=422,
            detail="No ETL model saved for this tool"
        )

    # Topological order: run stale deps with their own model first
    for dep_slug in config.get("etl_deps", []):
        dep_row = conn.execute(
            "SELECT * FROM _tools WHERE slug = ?", (dep_slug,)
        ).fetchone()
        if not dep_row:
            continue
        dep = dict(dep_row)
        dep_config = _load_config(dep)
        if dep.get("is_stale") and dep_config.get("etl_model"):
            etl_run_saved(conn, dep["id"], _visited)

    result = etl_apply(conn, tool_id, model)
    conn.execute("UPDATE _tools SET is_stale = 0 WHERE id = ?", (tool_id,))

    from engine.staleness import mark_dependents_stale
    mark_dependents_stale(conn, tool_slug)

    conn.commit()
    return result


# ============================================================
# SAVE / DRAFT
# ============================================================

def save_etl_version(
    conn: sqlite3.Connection,
    tool_id: int,
    model: dict,
    label: str = None,
) -> dict:
    tool   = get_tool(conn, tool_id)
    config = _load_config(tool)
    sql    = _compile(model)

    history = config.get("etl_history", [])
    history.insert(0, {
        "model":     model,
        "sql":       sql,
        "label":     label or f"Version {len(history) + 1}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    history = history[:20]

    config["etl_model"]   = model
    config["etl_sql"]     = sql
    config["etl_history"] = history
    config["etl_deps"]    = _etl_deps_from_model(model)

    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(config), tool_id)
    )
    conn.commit()
    return {"saved": True, "history": history}


def etl_save_draft(conn: sqlite3.Connection, tool_id: int, model: dict) -> dict:
    """Persist model without adding a history entry."""
    tool   = get_tool(conn, tool_id)
    config = _load_config(tool)
    sql    = _compile(model)

    config["etl_model"] = model
    config["etl_sql"]   = sql
    config["etl_deps"]  = _etl_deps_from_model(model)

    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(config), tool_id)
    )
    conn.commit()
    return {"saved": True}


# ============================================================
# CONFIG / SCHEMA
# ============================================================

def get_etl_config(conn: sqlite3.Connection, tool_id: int) -> dict:
    tool   = get_tool(conn, tool_id)
    config = _load_config(tool)
    return {
        "etl_model":   config.get("etl_model"),
        "etl_sql":     config.get("etl_sql", ""),
        "etl_history": config.get("etl_history", []),
        "etl_deps":    config.get("etl_deps", []),
    }


def get_etl_schema(conn: sqlite3.Connection, tool_id: int) -> dict:
    """Return all project tools + columns for the schema browser."""
    tools  = conn.execute("SELECT * FROM _tools ORDER BY id").fetchall()
    result = []
    for t in tools:
        t    = dict(t)
        cols = conn.execute("""
            SELECT slug, name, col_type, is_system
            FROM _columns
            WHERE tool_slug = ?
            ORDER BY position, id
        """, (t["slug"],)).fetchall()
        result.append({
            "slug":       t["slug"],
            "name":       t["name"],
            "icon":       t.get("icon", "📄"),
            "is_current": t["id"] == tool_id,
            "columns": [
                {
                    "slug":      c["slug"],
                    "name":      c["name"],
                    "type":      c["col_type"],
                    "is_system": bool(c["is_system"]),
                }
                for c in cols
            ],
        })
    return {"tools": result}


# ============================================================
# UTILITY
# ============================================================

def _check_sql_safety(sql: str) -> None:
    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach ", "pragma "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden SQL operation: '{keyword.strip()}'"
            )
