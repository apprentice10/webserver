"""
Sheet V1 — find/replace and column autocomplete business logic.
"""

import re
import sqlite3
from fastapi import HTTPException
from .service import get_engine, get_columns, update_cell


def _wildcard_to_regex(search: str, match_case: bool, match_entire_cell: bool) -> re.Pattern:
    escaped = re.escape(search).replace(r'\*', '.*').replace(r'\?', '.')
    if match_entire_cell:
        escaped = f'^{escaped}$'
    flags = 0 if match_case else re.IGNORECASE
    return re.compile(escaped, flags)


def find_replace_cells(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    search: str,
    replacement: str,
    match_case: bool,
    match_entire_cell: bool,
    scope: list[dict] | None,
) -> dict:
    if not search:
        return {"count": 0, "rows": []}

    tool = get_engine(conn, tool_id)
    tool_slug = tool["slug"]

    all_cols = get_columns(conn, tool_id)
    editable_slugs = {
        c["slug"] for c in all_cols
        if not c["is_system"] and c["slug"] not in ("rev", "log")
    }

    pattern = _wildcard_to_regex(search, match_case, match_entire_cell)

    if scope is None:
        raw_rows = conn.execute(
            f'SELECT __id FROM "{tool_slug}" ORDER BY __position'
        ).fetchall()
        cells = [
            {"row_id": row[0], "col_slug": slug}
            for row in raw_rows
            for slug in editable_slugs
        ]
    else:
        cells = [c for c in scope if c.get("col_slug") in editable_slugs]

    updated_rows = []
    for cell in cells:
        row_id = cell["row_id"]
        col_slug = cell["col_slug"]
        row = conn.execute(
            f'SELECT "{col_slug}" FROM "{tool_slug}" WHERE __id = ?', (row_id,)
        ).fetchone()
        if not row:
            continue
        old_val = str(row[0] or "")
        if not pattern.search(old_val):
            continue
        new_val = replacement if match_entire_cell else pattern.sub(replacement, old_val)
        updated = update_cell(conn, tool_id, row_id, project_id, col_slug, new_val)
        updated_rows.append(updated)

    return {"count": len(updated_rows), "rows": updated_rows}


def get_column_values(
    conn: sqlite3.Connection,
    tool_id: int,
    col_slug: str,
    prefix: str = "",
    limit: int = 20,
) -> list[str]:
    tool = get_engine(conn, tool_id)
    tool_slug = tool["slug"]

    col = conn.execute(
        "SELECT * FROM _columns WHERE tool_id = ? AND slug = ?", (tool_id, col_slug)
    ).fetchone()
    if not col:
        raise HTTPException(status_code=404, detail=f"Column '{col_slug}' not found")
    if dict(col).get("is_system"):
        raise HTTPException(status_code=400, detail="System columns do not support autocomplete")

    if prefix:
        safe = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = conn.execute(
            f'SELECT DISTINCT "{col_slug}" FROM "{tool_slug}" '
            f'WHERE "{col_slug}" IS NOT NULL AND "{col_slug}" != "" '
            f'AND "{col_slug}" LIKE ? ESCAPE "\\" ORDER BY "{col_slug}" LIMIT ?',
            (safe + "%", limit)
        ).fetchall()
    else:
        rows = conn.execute(
            f'SELECT DISTINCT "{col_slug}" FROM "{tool_slug}" '
            f'WHERE "{col_slug}" IS NOT NULL AND "{col_slug}" != "" '
            f'ORDER BY "{col_slug}" LIMIT ?',
            (limit,)
        ).fetchall()

    return [r[0] for r in rows if r[0]]
