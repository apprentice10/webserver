"""
MTO V1 ETL apply/run.

Writes ETL output to mto_utilities (replaces existing rows for this tool),
then auto-creates mto_typicals for any new distinct typical_name values.
Existing typicals are never deleted (orphan-safe).
"""
import json
import sqlite3

from fastapi import HTTPException

from dashboard.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError


def _compile_and_run(conn: sqlite3.Connection, model: dict) -> tuple[list, list]:
    try:
        sql = compile_sql(model)
    except (EtlValidationError, EtlCompilationError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    try:
        cur = conn.execute(sql)
        columns = [d[0].lower() for d in cur.description]
        rows = [dict(zip(columns, r)) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL error: {e}")
    return columns, rows


def _validate_mto_columns(columns: list) -> None:
    missing = [c for c in ("tag", "typical_name") if c not in columns]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"MTO ETL output must include column(s): {', '.join(missing)}",
        )


def _write_utilities_and_sync(conn: sqlite3.Connection, tool_id: int, rows: list) -> dict:
    conn.execute("DELETE FROM mto_utilities WHERE tool_id = ?", (tool_id,))

    written = 0
    for r in rows:
        tag = str(r.get("tag", "")).strip()
        typical_name = str(r.get("typical_name", "")).strip()
        if not tag or not typical_name:
            continue
        conn.execute(
            "INSERT INTO mto_utilities (tool_id, tag, typical_name) VALUES (?, ?, ?)",
            (tool_id, tag, typical_name),
        )
        written += 1

    existing_names = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM mto_typicals WHERE tool_id = ?", (tool_id,)
        ).fetchall()
    }
    distinct_names = {
        row[0]
        for row in conn.execute(
            "SELECT DISTINCT typical_name FROM mto_utilities"
            " WHERE tool_id = ? AND typical_name != ''",
            (tool_id,),
        ).fetchall()
    }
    new_names = sorted(distinct_names - existing_names)

    max_pos = conn.execute(
        "SELECT COALESCE(MAX(position), -1) FROM mto_typicals WHERE tool_id = ?",
        (tool_id,),
    ).fetchone()[0]
    for i, name in enumerate(new_names):
        conn.execute(
            "INSERT INTO mto_typicals (tool_id, name, description, position)"
            " VALUES (?, ?, '', ?)",
            (tool_id, name, max_pos + 1 + i),
        )

    return {"rows_written": written, "new_typicals": new_names}


def _persist_model(conn: sqlite3.Connection, tool_id: int, model: dict) -> None:
    row = conn.execute("SELECT query_config FROM _tools WHERE id = ?", (tool_id,)).fetchone()
    cfg = json.loads(row[0]) if row and row[0] else {}
    cfg["etl_model"] = model
    cfg["etl_deps"] = [
        s["name"] for s in model.get("sources", []) if s.get("type") == "table"
    ]
    conn.execute(
        "UPDATE _tools SET query_config = ? WHERE id = ?",
        (json.dumps(cfg), tool_id),
    )


def mto_etl_apply(conn: sqlite3.Connection, tool_id: int, model: dict) -> dict:
    columns, rows = _compile_and_run(conn, model)
    _validate_mto_columns(columns)
    result = _write_utilities_and_sync(conn, tool_id, rows)
    _persist_model(conn, tool_id, model)
    conn.commit()
    return result


def mto_etl_run_saved(conn: sqlite3.Connection, tool_id: int) -> dict:
    row = conn.execute("SELECT query_config FROM _tools WHERE id = ?", (tool_id,)).fetchone()
    cfg = json.loads(row[0]) if row and row[0] else {}
    model = cfg.get("etl_model")
    if not model:
        raise HTTPException(status_code=422, detail="No saved ETL model for this tool")
    columns, rows = _compile_and_run(conn, model)
    _validate_mto_columns(columns)
    result = _write_utilities_and_sync(conn, tool_id, rows)
    conn.execute("UPDATE _tools SET is_stale = 0 WHERE id = ?", (tool_id,))
    conn.commit()
    return result
