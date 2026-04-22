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

    # --------------------------------------------------------
    # Crea colonne mancanti
    # --------------------------------------------------------
    existing_slugs = {c["slug"] for c in get_columns(conn, tool_id)}
    cols_created   = 0

    for col_slug in etl_cols:
        if col_slug in SYSTEM_SLUGS or col_slug in INTERNAL_COLS:
            continue
        if col_slug not in existing_slugs:
            last_pos = conn.execute("""
                SELECT MAX(position) FROM _columns
                WHERE tool_id = ? AND is_system = 0
            """, (tool_id,)).fetchone()[0]
            new_pos = (last_pos or 1) + 1

            conn.execute("""
                INSERT INTO _columns (tool_id, tool_slug, slug, name, col_type, width, position, is_system)
                VALUES (?, ?, ?, ?, 'text', 120, ?, 0)
            """, (tool_id, slug, col_slug,
                  col_slug.upper().replace("_", " "), new_pos))

            add_column_to_table(conn, slug, col_slug)
            cols_created += 1

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

    conn.commit()

    return {
        "columns_created": cols_created,
        "created":         created,
        "updated":         updated,
        "skipped_cells":   skipped,
        "errors":          errors
    }


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

    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(config), tool_id)
    )
    conn.commit()

    return {"saved": True, "history": history}


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
        "etl_history": config.get("etl_history", [])
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
