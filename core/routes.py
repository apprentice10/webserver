"""
core/routes.py
--------------
Project management, filesystem browser, and ETL graph/run endpoints.
The server is stateless: every request carries ?db=<absolute path>.
No project registry — files are opened directly by path.
"""

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from engine.project_db import create_project_db, open_project_db, SCHEMA_VERSION

router    = APIRouter(tags=["project"])
fs_router = APIRouter(prefix="/api/fs", tags=["filesystem"])


# ── Internal helpers ──────────────────────────────────────────────────

def _open(db: str) -> sqlite3.Connection:
    db_path = Path(db)
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {db}")
    return open_project_db(db_path)


def _topo_sort(tools: list[dict]) -> list[dict]:
    slug_to_tool = {t["slug"]: t for t in tools}
    visited: set[str] = set()
    order: list[dict] = []

    def visit(slug: str) -> None:
        if slug in visited:
            return
        visited.add(slug)
        tool = slug_to_tool.get(slug)
        if not tool:
            return
        for dep in tool.get("etl_deps", []):
            if dep in slug_to_tool:
                visit(dep)
        order.append(tool)

    for t in tools:
        visit(t["slug"])
    return order


# ── Project endpoints ─────────────────────────────────────────────────

class ProjectNewBody(BaseModel):
    path:        str
    name:        str
    client:      Optional[str] = None
    description: Optional[str] = None


@router.post("/api/project/new")
def new_project(data: ProjectNewBody):
    db_path = Path(data.path)
    if db_path.exists():
        raise HTTPException(400, "A file already exists at this path")
    create_project_db(db_path)
    conn = open_project_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO _project (name, client, description, created_at, updated_at) VALUES (?,?,?,?,?)",
        (data.name, data.client or "", data.description or "", now, now),
    )
    conn.commit()
    conn.close()
    return {
        "path":        str(db_path),
        "name":        data.name,
        "client":      data.client or "",
        "description": data.description or "",
    }


class ProjectOpenBody(BaseModel):
    path: str


@router.post("/api/project/open")
def open_project(data: ProjectOpenBody):
    db_path = Path(data.path)
    if not db_path.exists():
        raise HTTPException(404, "File not found")
    try:
        conn = open_project_db(db_path)
    except Exception:
        raise HTTPException(400, "Cannot open file as a project database")
    try:
        row = conn.execute(
            "SELECT name, client, description FROM _project LIMIT 1"
        ).fetchone()
        tools = conn.execute(
            "SELECT id, name, slug, icon, tool_type, is_stale FROM _tools ORDER BY id"
        ).fetchall()
    except sqlite3.OperationalError:
        conn.close()
        raise HTTPException(400, "Not a valid project file (missing tables)")
    finally:
        conn.close()
    if not row:
        raise HTTPException(400, "Not a valid project file (no project record)")
    return {
        "path":        str(db_path),
        "name":        row["name"],
        "client":      row["client"],
        "description": row["description"],
        "tools":       [dict(t) for t in tools],
    }


@router.get("/api/project")
def get_project_meta(db: str = Query(...)):
    conn = _open(db)
    try:
        row = conn.execute(
            "SELECT name, client, description, created_at FROM _project LIMIT 1"
        ).fetchone()
        db_version = conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()
    if not row:
        raise HTTPException(400, "Not a valid project file")
    schema_warning = (
        f"This project requires schema v{db_version}. "
        f"This server supports up to v{SCHEMA_VERSION}. "
        "The project is read-only."
    ) if db_version > SCHEMA_VERSION else None
    return {
        "path": db,
        "name": row["name"],
        "client": row["client"],
        "description": row["description"],
        "schema_warning": schema_warning,
    }


@router.delete("/api/project")
def delete_project(db: str = Query(...)):
    db_path = Path(db)
    if not db_path.exists():
        raise HTTPException(404, "File not found")
    db_path.unlink()
    return {"ok": True, "deleted": db}


class BackupBody(BaseModel):
    subfolder: str = "_backups"
    keep:      int = 10


@router.post("/api/project/backup")
def backup_project(db: str = Query(...), data: BackupBody = BackupBody()):
    db_path = Path(db)
    if not db_path.exists():
        raise HTTPException(404, "Project file not found")
    backup_dir = db_path.parent / data.subfolder
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"{ts}_{db_path.name}"
    shutil.copy2(db_path, backup_path)
    if data.keep > 0:
        stem = db_path.name
        all_backups = sorted(backup_dir.glob(f"*_{stem}"))
        while len(all_backups) > data.keep:
            try:
                all_backups.pop(0).unlink()
            except OSError:
                break
    return {"backup": str(backup_path)}


# ── ETL graph / run ───────────────────────────────────────────────────

@router.get("/api/project/etl-graph")
def get_etl_graph(db: str = Query(...)):
    conn = _open(db)
    try:
        rows = conn.execute(
            "SELECT id, slug, name, icon, tool_type, is_stale, query_config FROM _tools ORDER BY id"
        ).fetchall()
    finally:
        conn.close()

    nodes, slug_set = [], set()
    for row in rows:
        cfg = json.loads(row["query_config"] or "{}")
        nodes.append({
            "id":        row["id"],
            "slug":      row["slug"],
            "name":      row["name"],
            "icon":      row["icon"] or "📄",
            "tool_type": row["tool_type"] or "",
            "has_etl":   bool(cfg.get("etl_model")),
            "is_stale":  bool(row["is_stale"]),
        })
        slug_set.add(row["slug"])

    edges = []
    for row in rows:
        cfg = json.loads(row["query_config"] or "{}")
        for dep in cfg.get("etl_deps", []):
            if dep in slug_set:
                edges.append({"from_slug": dep, "to_slug": row["slug"]})

    return {"nodes": nodes, "edges": edges}


@router.post("/api/project/etl-run-stale")
def etl_run_stale(db: str = Query(...)):
    from engine.etl import etl_run_saved
    conn = _open(db)
    try:
        rows = conn.execute(
            "SELECT id, slug, name, query_config FROM _tools WHERE is_stale = 1 ORDER BY id"
        ).fetchall()
        candidates = []
        for row in rows:
            cfg = json.loads(row["query_config"] or "{}")
            if cfg.get("etl_model"):
                candidates.append({
                    "id": row["id"], "slug": row["slug"], "name": row["name"],
                    "etl_deps": cfg.get("etl_deps", []),
                })
        ordered = _topo_sort(candidates)
        results, ran = [], 0
        for tool in ordered:
            try:
                r = etl_run_saved(conn, tool["id"])
                results.append({"id": tool["id"], "slug": tool["slug"], "name": tool["name"],
                                 "created": r.get("created", 0), "updated": r.get("updated", 0), "error": None})
                ran += 1
            except Exception as exc:
                results.append({"id": tool["id"], "slug": tool["slug"], "name": tool["name"],
                                 "created": 0, "updated": 0, "error": str(exc)})
    finally:
        conn.close()
    return {"results": results, "total_ran": ran, "total_skipped": len(candidates) - ran}


@router.post("/api/project/etl-run-all")
def etl_run_all(db: str = Query(...)):
    from engine.etl import etl_apply
    conn = _open(db)
    try:
        rows = conn.execute(
            "SELECT id, slug, name, query_config FROM _tools ORDER BY id"
        ).fetchall()
        candidates = []
        for row in rows:
            cfg = json.loads(row["query_config"] or "{}")
            if cfg.get("etl_model"):
                candidates.append({
                    "id": row["id"], "slug": row["slug"], "name": row["name"],
                    "etl_deps": cfg.get("etl_deps", []), "model": cfg["etl_model"],
                })
        ordered = _topo_sort(candidates)
        results, ran = [], 0
        for tool in ordered:
            try:
                r = etl_apply(conn, tool["id"], tool["model"])
                conn.execute("UPDATE _tools SET is_stale = 0 WHERE id = ?", (tool["id"],))
                conn.commit()
                results.append({"id": tool["id"], "slug": tool["slug"], "name": tool["name"],
                                 "created": r.get("created", 0), "updated": r.get("updated", 0), "error": None})
                ran += 1
            except Exception as exc:
                results.append({"id": tool["id"], "slug": tool["slug"], "name": tool["name"],
                                 "created": 0, "updated": 0, "error": str(exc)})
    finally:
        conn.close()
    return {"results": results, "total_ran": ran, "total_skipped": len(candidates) - ran}


# ── Filesystem browser ─────────────────────────────────────────────────

@fs_router.get("/browse")
def browse_fs(path: str = Query(...)):
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Path not found")
    if not p.is_dir():
        p = p.parent
    entries = []
    try:
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            try:
                if item.is_dir():
                    if not item.name.startswith('.'):
                        entries.append({"name": item.name, "type": "dir"})
                elif item.suffix.lower() == ".db":
                    entries.append({"name": item.name, "type": "file", "size": item.stat().st_size})
            except OSError:
                pass
    except PermissionError:
        pass
    parent = str(p.parent) if str(p.parent) != str(p) else None
    return {"path": str(p), "parent": parent, "entries": entries}


@fs_router.get("/cwd")
def get_cwd():
    return {"path": str(Path.cwd())}
