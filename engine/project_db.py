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
from sqlalchemy.orm import Session
from database import get_db

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
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _columns (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id   INTEGER NOT NULL,
    tool_slug TEXT NOT NULL,
    slug      TEXT NOT NULL,
    name      TEXT NOT NULL,
    col_type  TEXT DEFAULT 'text',
    width     INTEGER DEFAULT 120,
    position  INTEGER DEFAULT 0,
    is_system INTEGER DEFAULT 0,
    formula   TEXT,
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
    tool_slug TEXT NOT NULL,
    row_tag   TEXT NOT NULL,
    col_slug  TEXT NOT NULL,
    PRIMARY KEY (tool_slug, row_tag, col_slug)
);

CREATE TABLE IF NOT EXISTS _audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT DEFAULT (datetime('now')),
    tool_slug TEXT,
    action    TEXT,
    row_tag   TEXT,
    field     TEXT,
    old_val   TEXT,
    new_val   TEXT
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

def open_project_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"File DB progetto non trovato: {db_path.name}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ============================================================
# FASTAPI DEPENDENCY
# ============================================================

def get_project_conn(
    request: "Request",
    registry_db: Session = Depends(get_db)
) -> Generator[sqlite3.Connection, None, None]:
    from fastapi import Request as _Request
    from core.models import Project

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

    project = registry_db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    db_path = DATA_DIR / project.db_path
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
    new_val: str = None
) -> None:
    conn.execute(
        "INSERT INTO _audit (tool_slug, action, row_tag, field, old_val, new_val) VALUES (?,?,?,?,?,?)",
        (tool_slug, action, row_tag, field,
         str(old_val) if old_val is not None else None,
         str(new_val) if new_val is not None else None)
    )


# ============================================================
# SERIALIZZAZIONE ROW
# ============================================================

def serialize_active_row(row: sqlite3.Row, tool_id: int, project_id: int) -> dict:
    d = dict(row)
    result = {
        "id":         d["__id"],
        "tool_id":    tool_id,
        "project_id": project_id,
        "position":   d.get("__position", 0),
        "is_deleted": False,
        "row_log":    d.get("__log"),
        "created_at": d.get("__created_at"),
        "updated_at": None,
    }
    # Tutti i campi non-interno
    for k, v in d.items():
        if not k.startswith("__"):
            result[k] = v if v is not None else ""
    result["log"] = d.get("__log", "") or ""
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
