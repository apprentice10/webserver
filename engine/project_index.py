"""
engine/project_index.py
------------------------
Indice leggero dei progetti: mappa project_id → db_path.

Gestisce data/projects.db (SQLite raw, NO ORM).
Sostituisce registry.db per la sola funzione di discovery dei progetti.
Ogni progetto rimane autosufficiente nel suo per-project DB.
"""

import sqlite3
from pathlib import Path

from fastapi import HTTPException

_INDEX_PATH = Path(__file__).parent.parent / "data" / "projects.db"

_DDL = """
CREATE TABLE IF NOT EXISTS projects (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    client  TEXT NOT NULL DEFAULT '',
    db_path TEXT NOT NULL UNIQUE
);
"""


def _connect() -> sqlite3.Connection:
    _INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_INDEX_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_DDL)
    conn.commit()
    return conn


def init_index() -> None:
    conn = _connect()
    conn.executescript(_DDL)
    conn.commit()
    conn.close()


def add_project(name: str, client: str, db_path: str) -> int:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO projects (name, client, db_path) VALUES (?, ?, ?)",
        (name, client or "", db_path),
    )
    conn.commit()
    project_id = cur.lastrowid
    conn.close()
    return project_id


def remove_project(project_id: int) -> None:
    conn = _connect()
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()


def list_projects() -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT * FROM projects ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project(project_id: int) -> dict:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return dict(row)


def get_db_path(project_id: int) -> Path:
    from engine.project_db import DATA_DIR
    project = get_project(project_id)
    return DATA_DIR / project["db_path"]
