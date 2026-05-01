"""
engine/project_db.py
---------------------
Gestione connessioni ai database per-progetto (raw sqlite3).

Ogni progetto ha il suo file .db in data/.
Le tabelle di sistema sono prefissate con _ (underscore).
Le tabelle dei tool sono flat tables con nome = slug del tool.
"""

import sqlite3
import json
from pathlib import Path
from typing import Generator, TYPE_CHECKING
from fastapi import HTTPException, Depends, Request

DATA_DIR = Path("data")

SYSTEM_COLUMNS = {"tag", "rev", "log"}
INTERNAL_PREFIX = "__"

DDL_SYSTEM_TABLES = """
CREATE TABLE IF NOT EXISTS _tools (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    tool_type    TEXT,
    icon         TEXT DEFAULT '📄',
    rev          TEXT DEFAULT 'A',
    query_config TEXT,
    note         TEXT,
    is_stale     INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _columns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id       INTEGER NOT NULL,
    tool_slug     TEXT NOT NULL,
    slug          TEXT NOT NULL,
    name          TEXT NOT NULL,
    col_type      TEXT DEFAULT 'text',
    width         INTEGER DEFAULT 120,
    position      INTEGER DEFAULT 0,
    is_system     INTEGER DEFAULT 0,
    formula       TEXT,
    lineage_info  TEXT,
    UNIQUE (tool_slug, slug)
);

CREATE TABLE IF NOT EXISTS _trash (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_slug  TEXT NOT NULL,
    orig_pos   INTEGER,
    row_data   TEXT NOT NULL,
    row_log    TEXT,
    deleted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _overrides (
    tool_slug  TEXT NOT NULL,
    row_tag    TEXT NOT NULL,
    col_slug   TEXT NOT NULL,
    etl_value  TEXT,
    PRIMARY KEY (tool_slug, row_tag, col_slug)
);

CREATE TABLE IF NOT EXISTS _audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT DEFAULT (datetime('now')),
    tool_slug   TEXT,
    action      TEXT,
    change_type TEXT,
    row_tag     TEXT,
    col_slug    TEXT,
    field       TEXT,
    old_val     TEXT,
    new_val     TEXT,
    revision    TEXT,
    changed_by  TEXT
);

CREATE TABLE IF NOT EXISTS _project (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    client      TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type_slug   TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    etl_sql     TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _flags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT UNIQUE NOT NULL,
    color     TEXT NOT NULL DEFAULT '#888888',
    is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS _cell_flags (
    tool_slug TEXT NOT NULL,
    row_tag   TEXT NOT NULL,
    col_slug  TEXT NOT NULL DEFAULT '',
    flag_id   INTEGER NOT NULL REFERENCES _flags(id) ON DELETE CASCADE,
    PRIMARY KEY (tool_slug, row_tag, col_slug, flag_id)
);
"""

SYSTEM_COLUMN_DEFS = [
    {"slug": "tag", "name": "TAG", "col_type": "text", "width": 110, "position": 0,   "is_system": 1},
    {"slug": "rev", "name": "REV", "col_type": "text", "width": 60,  "position": 1,   "is_system": 1},
    {"slug": "log", "name": "LOG", "col_type": "log",  "width": 260, "position": 999, "is_system": 1},
]


# ============================================================
# CREAZIONE FILE DB
# ============================================================

def create_project_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(DDL_SYSTEM_TABLES)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.commit()
    conn.close()


# ============================================================
# CONNESSIONE
# ============================================================

def _migrate_project_db(conn: sqlite3.Connection) -> None:
    tools_cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "is_stale" not in tools_cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN is_stale INTEGER DEFAULT 0")

    col_cols = {row[1] for row in conn.execute("PRAGMA table_info(_columns)").fetchall()}
    if "lineage_info" not in col_cols:
        conn.execute("ALTER TABLE _columns ADD COLUMN lineage_info TEXT")

    ovr_cols = {row[1] for row in conn.execute("PRAGMA table_info(_overrides)").fetchall()}
    if "etl_value" not in ovr_cols:
        conn.execute("ALTER TABLE _overrides ADD COLUMN etl_value TEXT")

    audit_cols = {row[1] for row in conn.execute("PRAGMA table_info(_audit)").fetchall()}
    for col_def in [
        ("change_type", "TEXT"),
        ("col_slug",    "TEXT"),
        ("revision",    "TEXT"),
        ("changed_by",  "TEXT"),
    ]:
        if col_def[0] not in audit_cols:
            conn.execute(f"ALTER TABLE _audit ADD COLUMN {col_def[0]} {col_def[1]}")

    existing_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "_project" not in existing_tables:
        conn.execute("""CREATE TABLE _project (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')))""")
    if "_templates" not in existing_tables:
        conn.execute("""CREATE TABLE _templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, type_slug TEXT NOT NULL,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            etl_sql TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')))""")

    if "_flags" not in existing_tables:
        conn.execute("""CREATE TABLE _flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL DEFAULT '#888888',
            is_system INTEGER NOT NULL DEFAULT 0)""")

    if "_cell_flags" not in existing_tables:
        conn.execute("""CREATE TABLE _cell_flags (
            tool_slug TEXT NOT NULL,
            row_tag   TEXT NOT NULL,
            col_slug  TEXT NOT NULL DEFAULT '',
            flag_id   INTEGER NOT NULL REFERENCES _flags(id) ON DELETE CASCADE,
            PRIMARY KEY (tool_slug, row_tag, col_slug, flag_id))""")

    # Idempotent seed: system flags must always exist
    conn.execute("""
        INSERT OR IGNORE INTO _flags (name, color, is_system) VALUES
            ('manual_edit',     '#FF8C00', 1),
            ('ETL: Eliminated', '#DC143C', 1)
    """)

    conn.commit()


def open_project_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"File DB progetto non trovato: {db_path.name}")
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _migrate_project_db(conn)
    return conn


# ============================================================
# FASTAPI DEPENDENCY
# ============================================================

def get_project_conn(
    request: "Request",
) -> Generator[sqlite3.Connection, None, None]:
    from engine.project_index import get_db_path

    # project_id può venire dal path (/project/{project_id}) o dal query string
    pid_raw = (
        request.path_params.get("project_id")
        or request.query_params.get("project_id")
    )
    if not pid_raw:
        raise HTTPException(status_code=400, detail="project_id richiesto")
    try:
        project_id = int(pid_raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id non valido")

    db_path = get_db_path(project_id)
    conn = open_project_db(db_path)
    try:
        yield conn
    finally:
        conn.close()


# ============================================================
# DDL TOOL TABLE
# ============================================================

def create_tool_table(conn: sqlite3.Connection, slug: str) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{slug}" (
            __id         INTEGER PRIMARY KEY AUTOINCREMENT,
            __position   INTEGER DEFAULT 0,
            __log        TEXT,
            __created_at TEXT DEFAULT (datetime('now')),
            tag          TEXT NOT NULL UNIQUE,
            rev          TEXT DEFAULT 'A'
        )
    """)


def add_column_to_table(conn: sqlite3.Connection, slug: str, col_slug: str) -> None:
    conn.execute(f'ALTER TABLE "{slug}" ADD COLUMN "{col_slug}" TEXT')


# ============================================================
# AUDIT
# ============================================================

def audit(
    conn: sqlite3.Connection,
    tool_slug: str,
    action: str,
    row_tag: str = None,
    field: str = None,
    old_val: str = None,
    new_val: str = None,
    change_type: str = None,
    revision: str = None,
    changed_by: str = None,
    col_slug: str = None,
) -> None:
    effective_col = col_slug or field
    conn.execute(
        """INSERT INTO _audit
           (tool_slug, action, change_type, row_tag, col_slug, field, old_val, new_val, revision, changed_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (tool_slug, action, change_type, row_tag,
         effective_col, field,
         str(old_val) if old_val is not None else None,
         str(new_val) if new_val is not None else None,
         revision, changed_by)
    )


# ============================================================
# SERIALIZZAZIONE ROW
# ============================================================

def serialize_active_row(
    row: sqlite3.Row,
    tool_id: int,
    project_id: int,
    overridden_cols: set | None = None,
) -> dict:
    d = dict(row)
    result = {
        "id":             d["__id"],
        "tool_id":        tool_id,
        "project_id":     project_id,
        "position":       d.get("__position", 0),
        "is_deleted":     False,
        "row_log":        d.get("__log"),
        "created_at":     d.get("__created_at"),
        "updated_at":     None,
        "overridden_cols": overridden_cols if overridden_cols else {},
    }
    # Tutti i campi non-interno
    for k, v in d.items():
        if not k.startswith("__"):
            result[k] = v if v is not None else ""
    result["log"] = d.get("__log", "") or ""
    return result


def get_row_overrides(conn: sqlite3.Connection, tool_slug: str, row_tag: str) -> dict:
    """Ritorna {col_slug: etl_value} per la riga specificata."""
    rows = conn.execute(
        "SELECT col_slug, etl_value FROM _overrides WHERE tool_slug = ? AND row_tag = ?",
        (tool_slug, row_tag)
    ).fetchall()
    return {r["col_slug"]: r["etl_value"] for r in rows}


def get_tool_overrides(conn: sqlite3.Connection, tool_slug: str) -> dict:
    """Ritorna {row_tag: {col_slug: etl_value}} per tutti gli override del tool."""
    rows = conn.execute(
        "SELECT row_tag, col_slug, etl_value FROM _overrides WHERE tool_slug = ?",
        (tool_slug,)
    ).fetchall()
    result: dict = {}
    for r in rows:
        result.setdefault(r["row_tag"], {})[r["col_slug"]] = r["etl_value"]
    return result


def serialize_trash_row(trash_row: sqlite3.Row, tool_id: int, project_id: int) -> dict:
    d = dict(trash_row)
    try:
        row_data = json.loads(d.get("row_data", "{}"))
    except Exception:
        row_data = {}
    result = {
        "id":         d["id"],
        "tool_id":    tool_id,
        "project_id": project_id,
        "position":   d.get("orig_pos", 0),
        "is_deleted": True,
        "row_log":    d.get("row_log"),
        "created_at": None,
        "updated_at": None,
        "log":        d.get("row_log", "") or "",
    }
    result.update({k: v if v is not None else "" for k, v in row_data.items()})
    return result
