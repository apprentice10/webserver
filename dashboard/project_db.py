"""
engine/project_db.py
---------------------
Gestione connessioni ai database per-progetto (raw sqlite3).

Ogni progetto ha il suo file .db in data/.
Le tabelle di sistema sono prefissate con _ (underscore).
Le tabelle dei tool sono flat tables con nome = slug del tool.
"""

import logging
import shutil
import sqlite3
import json
from pathlib import Path
from typing import Generator, TYPE_CHECKING
from fastapi import HTTPException, Depends, Request

logger = logging.getLogger("engine.project_db")

DATA_DIR    = Path("data")
BACKUPS_DIR = DATA_DIR / "backups"

# Bump this whenever DDL_SYSTEM_TABLES or any system table structure changes.
# See engine/project_db.py.md for the full rule.
SCHEMA_VERSION = 12

SYSTEM_COLUMNS = {"tag", "rev", "log"}
INTERNAL_PREFIX = "__"

DDL_SYSTEM_TABLES = """
CREATE TABLE IF NOT EXISTS _tool_groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    icon         TEXT DEFAULT '',
    position     INTEGER DEFAULT 0,
    is_collapsed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS _tools (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT UNIQUE NOT NULL,
    name           TEXT NOT NULL,
    tool_type      TEXT,
    engine_version TEXT NOT NULL DEFAULT '1.0',
    icon           TEXT DEFAULT '📄',
    rev            TEXT DEFAULT 'A',
    query_config   TEXT,
    note           TEXT,
    is_stale       INTEGER DEFAULT 0,
    position       INTEGER DEFAULT 0,
    group_id       INTEGER,
    is_trashed     INTEGER DEFAULT 0,
    trashed_at     TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
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
    note      TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tool_slug, row_tag, col_slug, flag_id)
);

CREATE TABLE IF NOT EXISTS _conditional_flag_rules (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_slug TEXT NOT NULL,
    col_slug  TEXT NOT NULL,
    flag_id   INTEGER NOT NULL REFERENCES _flags(id) ON DELETE CASCADE,
    operator  TEXT NOT NULL,
    value     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS _revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      INTEGER NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    description TEXT,
    author      TEXT
);

CREATE TABLE IF NOT EXISTS _revision_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id  INTEGER NOT NULL REFERENCES _revisions(id),
    tool_slug    TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _toolkit_config (
    tool_id    TEXT NOT NULL,
    toolkit_id TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (tool_id, toolkit_id)
);
"""

SYSTEM_COLUMN_DEFS = [
    {"slug": "tag", "name": "TAG", "col_type": "text", "width": 110, "position": 0,   "is_system": 1},
    {"slug": "rev", "name": "REV", "col_type": "integer", "width": 60,  "position": 1,   "is_system": 1},
    {"slug": "log", "name": "LOG", "col_type": "log",  "width": 260, "position": 999, "is_system": 1},
]


# ============================================================
# CREAZIONE FILE DB
# ============================================================

def create_project_db(db_path: Path) -> None:
    from dashboard.utils import now_str
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(DDL_SYSTEM_TABLES)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.execute(
        "INSERT OR IGNORE INTO _revisions (number, created_at, description, author) VALUES (?, ?, ?, ?)",
        (0, now_str(), "First issue", "")
    )
    conn.commit()
    conn.close()


# ============================================================
# MIGRATIONS
# ============================================================

def _backup_pre_migration(db_path: Path, from_version: int) -> None:
    """Safety copy to BACKUPS_DIR before migrating. Skipped if backup already exists."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUPS_DIR / f"{db_path.stem}_pre_migration_v{from_version}.db"
    if not backup_path.exists():
        shutil.copy2(db_path, backup_path)


def _migrate_to_v1(conn: sqlite3.Connection) -> None:
    """Absorbs all pre-versioning ad-hoc schema checks into a single formal step."""
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
    for col_name, col_type in [
        ("change_type", "TEXT"),
        ("col_slug",    "TEXT"),
        ("revision",    "TEXT"),
        ("changed_by",  "TEXT"),
    ]:
        if col_name not in audit_cols:
            conn.execute(f"ALTER TABLE _audit ADD COLUMN {col_name} {col_type}")

    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "_project" not in existing:
        conn.execute("""CREATE TABLE _project (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')))""")
    if "_templates" not in existing:
        conn.execute("""CREATE TABLE _templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, type_slug TEXT NOT NULL,
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            etl_sql TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')))""")
    if "_flags" not in existing:
        conn.execute("""CREATE TABLE _flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL DEFAULT '#888888', is_system INTEGER NOT NULL DEFAULT 0)""")
    if "_cell_flags" not in existing:
        conn.execute("""CREATE TABLE _cell_flags (
            tool_slug TEXT NOT NULL, row_tag TEXT NOT NULL, col_slug TEXT NOT NULL DEFAULT '',
            flag_id INTEGER NOT NULL REFERENCES _flags(id) ON DELETE CASCADE,
            PRIMARY KEY (tool_slug, row_tag, col_slug, flag_id))""")

    conn.execute("""INSERT OR IGNORE INTO _flags (name, color, is_system) VALUES
        ('manual_edit', '#FF8C00', 1), ('ETL: Eliminated', '#DC143C', 1)""")

    for (tbl,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
        if tbl.startswith("_"):
            continue
        cols = {r[1] for r in conn.execute(f'PRAGMA table_info("{tbl}")')}
        if "__position" in cols:
            conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{tbl}_pos" ON "{tbl}" (__position)')


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    """Add revision tables; seed rev-0; cast existing rev column values to 0."""
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    if "_revisions" not in existing:
        conn.execute("""CREATE TABLE _revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number INTEGER NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            description TEXT,
            author TEXT)""")

    if "_revision_snapshots" not in existing:
        conn.execute("""CREATE TABLE _revision_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            revision_id INTEGER NOT NULL REFERENCES _revisions(id),
            tool_slug TEXT NOT NULL,
            columns_json TEXT NOT NULL,
            rows_json TEXT NOT NULL)""")

    # Seed revision 0 if table is empty
    if conn.execute("SELECT COUNT(*) FROM _revisions").fetchone()[0] == 0:
        from dashboard.utils import now_str
        conn.execute(
            "INSERT INTO _revisions (number, created_at, description, author) VALUES (?, ?, ?, ?)",
            (0, now_str(), "First issue", "")
        )

    # Cast rev column values to 0 for all tool tables where rev was TEXT
    for (tbl,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
        if tbl.startswith("_"):
            continue
        col_types = {r[1]: r[2] for r in conn.execute(f'PRAGMA table_info("{tbl}")')}
        if col_types.get("rev", "").upper() == "TEXT":
            conn.execute(f'UPDATE "{tbl}" SET rev = 0')

    conn.execute("UPDATE _audit SET revision = '0' WHERE revision IS NULL OR revision = ''")


def _migrate_to_v3(conn: sqlite3.Connection) -> None:
    """Rename instrument-list type_slug → sheet in _tools and _templates."""
    conn.execute("UPDATE _tools SET tool_type = 'sheet' WHERE tool_type = 'instrument-list'")
    conn.execute("UPDATE _templates SET type_slug = 'sheet' WHERE type_slug = 'instrument-list'")


def _migrate_to_v4(conn: sqlite3.Connection) -> None:
    """Add engine_version column to _tools; default existing rows to '1.0'."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "engine_version" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN engine_version TEXT NOT NULL DEFAULT '1.0'")


def _migrate_to_v5(conn: sqlite3.Connection) -> None:
    """Add position column to _tools; seed from existing id order so display order is preserved."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "position" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN position INTEGER DEFAULT 0")
    rows = conn.execute("SELECT id FROM _tools ORDER BY id").fetchall()
    for idx, row in enumerate(rows):
        conn.execute("UPDATE _tools SET position = ? WHERE id = ?", (idx, row[0]))


def _migrate_to_v6(conn: sqlite3.Connection) -> None:
    """Add _tool_groups table and group_id column to _tools."""
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "_tool_groups" not in existing:
        conn.execute("""CREATE TABLE _tool_groups (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            icon         TEXT DEFAULT '',
            position     INTEGER DEFAULT 0,
            is_collapsed INTEGER DEFAULT 0)""")
    cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "group_id" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN group_id INTEGER")


def _migrate_to_v7(conn: sqlite3.Connection) -> None:
    """Add is_trashed and trashed_at columns to _tools for soft-delete."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "is_trashed" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN is_trashed INTEGER DEFAULT 0")
    if "trashed_at" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN trashed_at TEXT")


def _migrate_to_v8(conn: sqlite3.Connection) -> None:
    """Add sort_filter_state column to _tools for per-tool sort/filter persistence."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(_tools)").fetchall()}
    if "sort_filter_state" not in cols:
        conn.execute("ALTER TABLE _tools ADD COLUMN sort_filter_state TEXT")


def _migrate_to_v9(conn: sqlite3.Connection) -> None:
    """Add note to _cell_flags and create _conditional_flag_rules table."""
    cf_cols = {row[1] for row in conn.execute("PRAGMA table_info(_cell_flags)").fetchall()}
    if "note" not in cf_cols:
        conn.execute("ALTER TABLE _cell_flags ADD COLUMN note TEXT NOT NULL DEFAULT ''")
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "_conditional_flag_rules" not in existing:
        conn.execute("""CREATE TABLE _conditional_flag_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_slug TEXT NOT NULL, col_slug TEXT NOT NULL,
            flag_id INTEGER NOT NULL REFERENCES _flags(id) ON DELETE CASCADE,
            operator TEXT NOT NULL, value TEXT NOT NULL DEFAULT '')""")


def _migrate_to_v10(conn: sqlite3.Connection) -> None:
    """Create MTO engine tables: typicals, materials, images, utilities, tag_placements."""
    conn.execute("""CREATE TABLE IF NOT EXISTS mto_typicals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id     INTEGER NOT NULL,
        name        TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        position    INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS mto_materials (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        typical_id       INTEGER NOT NULL REFERENCES mto_typicals(id) ON DELETE CASCADE,
        tag              TEXT NOT NULL DEFAULT '',
        rev              INTEGER NOT NULL DEFAULT 0,
        log              TEXT NOT NULL DEFAULT '',
        part_description TEXT NOT NULL DEFAULT '',
        size             TEXT NOT NULL DEFAULT '',
        material         TEXT NOT NULL DEFAULT '',
        uom              TEXT NOT NULL DEFAULT '',
        quantity         REAL NOT NULL DEFAULT 0,
        position         INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS mto_images (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        typical_id  INTEGER NOT NULL REFERENCES mto_typicals(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL DEFAULT '',
        format      TEXT NOT NULL DEFAULT '',
        content     BLOB NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS mto_utilities (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id      INTEGER NOT NULL,
        tag          TEXT NOT NULL DEFAULT '',
        typical_name TEXT NOT NULL DEFAULT '')""")
    conn.execute("""CREATE TABLE IF NOT EXISTS mto_tag_placements (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        typical_id INTEGER NOT NULL REFERENCES mto_typicals(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL DEFAULT '',
        label_x    REAL NOT NULL DEFAULT 0,
        label_y    REAL NOT NULL DEFAULT 0,
        arrow_x    REAL NOT NULL DEFAULT 0,
        arrow_y    REAL NOT NULL DEFAULT 0)""")


def _migrate_to_v11(conn: sqlite3.Connection) -> None:
    """Add mto_material_columns (per-tool column defs) and mto_sf_state (per-typical sort/filter)."""
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "mto_material_columns" not in existing:
        conn.execute("""CREATE TABLE mto_material_columns (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_id   INTEGER NOT NULL,
            name      TEXT NOT NULL,
            slug      TEXT NOT NULL,
            col_type  TEXT NOT NULL DEFAULT 'text',
            width     INTEGER NOT NULL DEFAULT 120,
            position  INTEGER NOT NULL DEFAULT 0,
            is_system INTEGER NOT NULL DEFAULT 0
        )""")
    if "mto_sf_state" not in existing:
        conn.execute("""CREATE TABLE mto_sf_state (
            typical_id INTEGER PRIMARY KEY,
            state      TEXT NOT NULL DEFAULT '{}'
        )""")


def _migrate_to_v12(conn: sqlite3.Connection) -> None:
    """Add _toolkit_config table for per-instance toolkit configuration storage."""
    existing = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "_toolkit_config" not in existing:
        conn.execute("""CREATE TABLE _toolkit_config (
            tool_id     TEXT NOT NULL,
            toolkit_id  TEXT NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (tool_id, toolkit_id))""")


_MIGRATIONS: dict = {
    1: _migrate_to_v1, 2: _migrate_to_v2, 3: _migrate_to_v3,
    4: _migrate_to_v4, 5: _migrate_to_v5, 6: _migrate_to_v6,
    7: _migrate_to_v7, 8: _migrate_to_v8, 9: _migrate_to_v9,
    10: _migrate_to_v10, 11: _migrate_to_v11, 12: _migrate_to_v12,
}


def _run_migrations(conn: sqlite3.Connection, db_path: Path) -> None:
    """Runs all pending migrations in version order. Takes a backup before first migration."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current >= SCHEMA_VERSION:
        return
    _backup_pre_migration(db_path, current)
    for version in range(current + 1, SCHEMA_VERSION + 1):
        try:
            _MIGRATIONS[version](conn)
            conn.execute(f"PRAGMA user_version = {version}")
            conn.commit()
        except Exception as exc:
            conn.rollback()
            raise RuntimeError(
                f"Migration to schema v{version} failed. "
                f"Pre-migration backup saved to {BACKUPS_DIR}. Error: {exc}"
            ) from exc


# ============================================================
# CONNESSIONE
# ============================================================

def open_project_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"Project DB not found: {db_path.name}")
    try:
        conn = sqlite3.connect(str(db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        db_version = conn.execute("PRAGMA user_version").fetchone()[0]
        if db_version < SCHEMA_VERSION:
            logger.info("open_project_db: migrating %s from v%d to v%d", db_path.name, db_version, SCHEMA_VERSION)
            _run_migrations(conn, db_path)
        return conn
    except HTTPException:
        raise
    except Exception:
        logger.error("open_project_db: failed to open db_path=%s", db_path, exc_info=True)
        raise


# ============================================================
# FASTAPI DEPENDENCY
# ============================================================

def get_project_conn(
    request: "Request",
) -> Generator[sqlite3.Connection, None, None]:
    db_raw = request.query_params.get("db")
    if not db_raw:
        raise HTTPException(status_code=400, detail="db path required")
    db_path = Path(db_raw)
    logger.debug("get_project_conn: %s %s db=%s exists=%s", request.method, request.url.path, db_path, db_path.exists())
    conn = open_project_db(db_path)
    try:
        db_version = conn.execute("PRAGMA user_version").fetchone()[0]
        if db_version > SCHEMA_VERSION and request.method != "GET":
            raise HTTPException(
                status_code=403,
                detail=f"Project schema v{db_version} is newer than this server (supports up to v{SCHEMA_VERSION}). Project is read-only.",
            )
        yield conn
    except HTTPException:
        raise
    except Exception:
        logger.error("get_project_conn: unhandled exception for db=%s path=%s", db_path, request.url.path, exc_info=True)
        raise
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
            rev          INTEGER DEFAULT 0
        )
    """)
    conn.execute(f'CREATE INDEX IF NOT EXISTS "idx_{slug}_pos" ON "{slug}" (__position)')


def add_column_to_table(conn: sqlite3.Connection, slug: str, col_slug: str) -> None:
    conn.execute(f'ALTER TABLE "{slug}" ADD COLUMN "{col_slug}" TEXT')


# ============================================================
# AUDIT
# ============================================================

def get_current_revision(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT MAX(number) FROM _revisions").fetchone()
    return row[0] if row and row[0] is not None else 0


def audit(
    conn: sqlite3.Connection,
    tool_slug: str,
    action: str,
    row_tag: str = None,
    field: str = None,
    old_val: str = None,
    new_val: str = None,
    change_type: str = None,
    revision: int = None,
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
