"""
engine/staleness.py
--------------------
ETL staleness helpers: mark tools stale and propagate to dependents.
"""

import json
import sqlite3


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
