"""
engine/etl.py
--------------
Motore ETL per flat tables.

Con la nuova architettura i tool sono tabelle SQLite native, quindi
le query ETL sono SQL diretto — nessun parsing speciale.
I tool si referenziano come: SELECT il.tag FROM instrument_list il
"""

import json
import sqlite3
from datetime import datetime, timezone
from fastapi import HTTPException

from engine.project_db import (
    add_column_to_table, audit, SYSTEM_COLUMN_DEFS
)
from engine.service import get_tool, get_columns
from engine.sql_parser import (
    resolve_etl_deps as _resolve_etl_deps,
    extract_col_lineage as _extract_col_lineage,
    extract_table_aliases as _extract_table_aliases,
    lineage_to_source as _lineage_to_source,
)


SYSTEM_SLUGS = {"tag", "rev", "log"}
INTERNAL_COLS = {"__id", "__position", "__log", "__created_at"}


# ============================================================
# PREVIEW
# ============================================================

def etl_preview(conn: sqlite3.Connection, tool_id: int, sql: str) -> dict:
    get_tool(conn, tool_id)

    sql = sql.strip()
    if not sql:
        raise HTTPException(status_code=422, detail="Query ETL vuota")

    _check_sql_safety(sql)

    try:
        cur = conn.execute(sql)
        columns = [d[0].lower() for d in cur.description]
        rows    = [dict(zip(columns, row)) for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore SQL: {e}")

    warnings = []
    if "tag" not in columns:
        warnings.append("La query non include 'tag' — necessario per il merge.")

    return {
        "columns":   columns,
        "rows":      rows,
        "row_count": len(rows),
        "warnings":  warnings
    }


# ============================================================
# APPLY
# ============================================================

def etl_apply(conn: sqlite3.Connection, tool_id: int, sql: str) -> dict:
    tool     = get_tool(conn, tool_id)
    slug     = tool["slug"]
    rev      = tool["rev"]
    preview  = etl_preview(conn, tool_id, sql)
    etl_rows = preview["rows"]
    etl_cols = [c for c in preview["columns"] if c != "log"]

    # Compute lineage once from the SQL
    col_lineage = _extract_col_lineage(sql)
    tbl_aliases = _extract_table_aliases(sql)

    # --------------------------------------------------------
    # Crea colonne mancanti + aggiorna lineage_info
    # --------------------------------------------------------
    existing_slugs = {c["slug"] for c in get_columns(conn, tool_id)}
    cols_created   = 0

    for col_slug in etl_cols:
        if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
            continue

        lineage_json = None
        source_expr = col_lineage.get(col_slug)
        if source_expr:
            lineage_data = _lineage_to_source(source_expr, tbl_aliases)
            lineage_json = json.dumps(lineage_data)

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
    # Merge righe
    # --------------------------------------------------------
    created = 0
    updated = 0
    skipped = 0
    errors  = []

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    for etl_row in etl_rows:
        tag_val = str(etl_row.get("tag", "")).strip()
        if not tag_val:
            errors.append("Riga senza TAG — saltata")
            continue

        try:
            existing = conn.execute(
                f'SELECT __id FROM "{slug}" WHERE tag = ?', (tag_val,)
            ).fetchone()

            if existing:
                row_id = existing[0]
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
                    conn.execute(
                        f'UPDATE "{slug}" SET "{col_slug}"=? WHERE __id=?',
                        (str_val, row_id)
                    )
                updated += 1

            else:
                insert_data = {
                    "tag":        tag_val,
                    "rev":        rev,
                    "__position": next_pos
                }
                for col_slug, val in etl_row.items():
                    if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
                        continue
                    insert_data[col_slug] = str(val).strip() if val is not None else None

                cols_str = ", ".join(f'"{c}"' for c in insert_data)
                placeholders = ", ".join("?" * len(insert_data))
                conn.execute(
                    f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
                    list(insert_data.values())
                )
                audit(conn, slug, "ETL_INSERT", row_tag=tag_val, new_val=tag_val)
                next_pos += 1
                created  += 1

        except Exception as e:
            errors.append(f"TAG '{tag_val}': {e}")
            continue

    # --------------------------------------------------------
    # Flag orphan rows (existed before ETL, missing from ETL result)
    # --------------------------------------------------------
    elim_flag = conn.execute(
        "SELECT id FROM _flags WHERE name = 'ETL: Eliminated'"
    ).fetchone()

    orphaned = 0
    if elim_flag:
        flag_id  = elim_flag[0]
        etl_tags = {str(r.get("tag", "")).strip() for r in etl_rows}
        etl_tags.discard("")
        all_tags = {r[0] for r in conn.execute(f'SELECT tag FROM "{slug}"').fetchall() if r[0]}
        orphan_tags = all_tags - etl_tags

        for tag in orphan_tags:
            conn.execute(
                "INSERT OR IGNORE INTO _cell_flags (tool_slug, row_tag, col_slug, flag_id) VALUES (?,?,?,?)",
                (slug, tag, "", flag_id)
            )
            audit(conn, slug, "ETL_ELIMINATED", row_tag=tag)
            orphaned += 1

        # Un-eliminate rows that reappeared in ETL source
        if etl_tags:
            placeholders = ",".join("?" * len(etl_tags))
            conn.execute(
                f"DELETE FROM _cell_flags WHERE tool_slug=? AND col_slug='' AND flag_id=? AND row_tag IN ({placeholders})",
                [slug, flag_id] + list(etl_tags)
            )

    conn.commit()

    return {
        "columns_created": cols_created,
        "created":         created,
        "updated":         updated,
        "skipped_cells":   skipped,
        "orphaned":        orphaned,
        "errors":          errors
    }


# ============================================================
# RUN SAVED
# ============================================================

def etl_run_saved(
    conn: sqlite3.Connection,
    tool_id: int,
    _visited: set = None
) -> dict:
    if _visited is None:
        _visited = set()

    tool = get_tool(conn, tool_id)
    tool_slug = tool["slug"]

    if tool_slug in _visited:
        raise HTTPException(
            status_code=400,
            detail=f"Dipendenza circolare rilevata: '{tool_slug}'"
        )
    _visited.add(tool_slug)

    config = get_etl_config(conn, tool_id)
    sql = config.get("etl_sql", "").strip()
    if not sql:
        raise HTTPException(
            status_code=422,
            detail="Nessuna query ETL salvata per questo tool"
        )

    # Topological order: run stale deps with their own ETL first
    for dep_slug in config.get("etl_deps", []):
        dep_row = conn.execute(
            "SELECT * FROM _tools WHERE slug = ?", (dep_slug,)
        ).fetchone()
        if not dep_row:
            continue
        dep = dict(dep_row)
        dep_config: dict = {}
        if dep.get("query_config"):
            try:
                dep_config = json.loads(dep["query_config"])
            except Exception:
                pass
        if dep.get("is_stale") and dep_config.get("etl_sql", "").strip():
            etl_run_saved(conn, dep["id"], _visited)

    result = etl_apply(conn, tool_id, sql)
    conn.execute("UPDATE _tools SET is_stale = 0 WHERE id = ?", (tool_id,))

    # Propagate: tools that depend on this one are now potentially stale
    from engine.service import mark_dependents_stale
    mark_dependents_stale(conn, tool_slug)

    conn.commit()
    return result


# ============================================================
# STORICO VERSIONI
# ============================================================

def save_etl_version(
    conn: sqlite3.Connection,
    tool_id: int,
    sql: str,
    label: str = None
) -> dict:
    tool = get_tool(conn, tool_id)

    config = {}
    if tool.get("query_config"):
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            config = {}

    history = config.get("etl_history", [])
    history.insert(0, {
        "sql":       sql,
        "label":     label or f"Versione {len(history) + 1}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    history = history[:20]

    config["etl_sql"]     = sql
    config["etl_history"] = history
    config["etl_deps"]    = _resolve_etl_deps(conn, sql)

    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(config), tool_id)
    )
    conn.commit()

    return {"saved": True, "history": history}


def etl_save_draft(conn: sqlite3.Connection, tool_id: int, sql: str) -> dict:
    """Aggiorna etl_sql senza aggiungere voce allo storico."""
    tool = get_tool(conn, tool_id)
    config = {}
    if tool.get("query_config"):
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            config = {}
    config["etl_sql"]  = sql
    config["etl_deps"] = _resolve_etl_deps(conn, sql)
    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(config), tool_id)
    )
    conn.commit()
    return {"saved": True}


def get_etl_config(conn: sqlite3.Connection, tool_id: int) -> dict:
    tool = get_tool(conn, tool_id)

    config = {}
    if tool.get("query_config"):
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            config = {}

    return {
        "etl_sql":     config.get("etl_sql", ""),
        "etl_history": config.get("etl_history", []),
        "etl_deps":    config.get("etl_deps", [])
    }


def get_etl_schema(conn: sqlite3.Connection, tool_id: int) -> dict:
    """
    Restituisce schema dei tool del progetto per lo schema browser.
    Ogni tool è una flat table — click su colonna inserisce tool_slug.col_slug
    """
    tools = conn.execute("SELECT * FROM _tools ORDER BY id").fetchall()
    result = []
    for t in tools:
        t = dict(t)
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
                    "is_system": bool(c["is_system"])
                }
                for c in cols
            ]
        })

    return {"tools": result}


# ============================================================
# UTILITY
# ============================================================

def _check_sql_safety(sql: str):
    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach ", "pragma "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Operazione non permessa: '{keyword.strip()}'"
            )
