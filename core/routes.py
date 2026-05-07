import json
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from engine import etl as _etl
from engine.project_db import create_project_db, open_project_db, DATA_DIR
from engine.project_index import (
    init_index, add_project, remove_project,
    list_projects as _list_projects,
    get_project as _get_project,
    get_db_path,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", "_", text)
    return text or "progetto"


def _make_db_filename(client: str, name: str) -> str:
    parts = []
    if client and client.strip():
        parts.append(_slugify(client.strip()))
    parts.append(_slugify(name.strip()) or "progetto")
    return "_".join(parts) + ".db"


class ProjectCreate(BaseModel):
    name:        str
    client:      Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    id:          int
    name:        str
    client:      Optional[str] = None
    description: Optional[str] = None
    db_path:     str

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ProjectResponse])
def list_projects():
    return _list_projects()


@router.post("/", response_model=ProjectResponse)
def create_project(data: ProjectCreate):
    base = _make_db_filename(data.client or "", data.name)

    # Garantisce unicità del filename
    db_filename = base
    db_path = DATA_DIR / db_filename
    counter = 2
    while db_path.exists():
        stem = base[:-3]
        db_filename = f"{stem}_{counter}.db"
        db_path = DATA_DIR / db_filename
        counter += 1

    # Crea il file DB per-progetto con DDL di sistema
    create_project_db(db_path)

    # Popola _project nel nuovo DB
    conn = open_project_db(db_path)
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO _project (name, client, description, created_at, updated_at) VALUES (?,?,?,?,?)",
        (data.name, data.client or "", data.description or "", now, now),
    )
    conn.commit()
    conn.close()

    # Registra nell'indice
    project_id = add_project(data.name, data.client or "", db_filename)
    return {
        "id": project_id,
        "name": data.name,
        "client": data.client,
        "description": data.description,
        "db_path": db_filename,
    }


@router.get("/{project_id}/export")
def export_project(project_id: int):
    project = _get_project(project_id)
    db_path = DATA_DIR / project["db_path"]
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Project file not found")
    return FileResponse(
        path=str(db_path),
        media_type="application/octet-stream",
        filename=db_path.name,
    )


@router.post("/import", response_model=ProjectResponse)
async def import_project(file: UploadFile = File(...)):
    SQLITE_MAGIC = b"SQLite format 3\x00"

    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
        tmp_path = Path(tmp.name)
        content = await file.read()
        tmp.write(content)

    try:
        if len(content) < 16 or content[:16] != SQLITE_MAGIC:
            raise HTTPException(status_code=400, detail="Not a valid SQLite file")

        conn = sqlite3.connect(str(tmp_path))
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT name, client FROM _project LIMIT 1"
            ).fetchone()
        except sqlite3.OperationalError:
            raise HTTPException(status_code=400, detail="File is not a valid project DB (missing _project table)")
        finally:
            conn.close()

        if not row:
            raise HTTPException(status_code=400, detail="Project DB has no project record")

        name   = row["name"]   or "Imported Project"
        client = row["client"] or ""

        base = _make_db_filename(client, name)
        db_filename = base
        db_path = DATA_DIR / db_filename
        counter = 2
        while db_path.exists():
            stem = base[:-3]
            db_filename = f"{stem}_{counter}.db"
            db_path = DATA_DIR / db_filename
            counter += 1

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_path, db_path)

    finally:
        tmp_path.unlink(missing_ok=True)

    project_id = add_project(name, client, db_filename)
    return {
        "id":          project_id,
        "name":        name,
        "client":      client,
        "description": None,
        "db_path":     db_filename,
    }


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int):
    return _get_project(project_id)


@router.delete("/{project_id}")
def delete_project(project_id: int):
    db_path = get_db_path(project_id)
    remove_project(project_id)
    if db_path.exists():
        db_path.unlink()
    return {"ok": True, "deleted_id": project_id}


# ============================================================
# ETL DESIGN — graph + bulk run
# ============================================================

def _topo_sort(tools: list[dict]) -> list[dict]:
    """Return tools in topological order (deps before dependents)."""
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


@router.get("/{project_id}/etl-graph")
def get_etl_graph(project_id: int):
    project = _get_project(project_id)
    conn = open_project_db(DATA_DIR / project["db_path"])
    try:
        rows = conn.execute(
            "SELECT id, slug, name, icon, tool_type, is_stale, query_config FROM _tools ORDER BY id"
        ).fetchall()
    finally:
        conn.close()

    nodes = []
    slug_set: set[str] = set()
    for row in rows:
        cfg = json.loads(row["query_config"] or "{}")
        has_etl = bool(cfg.get("etl_model"))
        nodes.append({
            "id":        row["id"],
            "slug":      row["slug"],
            "name":      row["name"],
            "icon":      row["icon"] or "📄",
            "tool_type": row["tool_type"] or "",
            "has_etl":   has_etl,
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


@router.post("/{project_id}/etl-run-stale")
def etl_run_stale(project_id: int):
    project = _get_project(project_id)
    conn = open_project_db(DATA_DIR / project["db_path"])
    try:
        rows = conn.execute(
            "SELECT id, slug, name, query_config FROM _tools WHERE is_stale = 1 ORDER BY id"
        ).fetchall()

        candidates = []
        for row in rows:
            cfg = json.loads(row["query_config"] or "{}")
            if cfg.get("etl_model"):
                candidates.append({
                    "id":        row["id"],
                    "slug":      row["slug"],
                    "name":      row["name"],
                    "etl_deps":  cfg.get("etl_deps", []),
                })

        ordered = _topo_sort(candidates)
        results = []
        ran = 0
        for tool in ordered:
            try:
                r = _etl.etl_run_saved(conn, tool["id"])
                results.append({
                    "id":      tool["id"],
                    "slug":    tool["slug"],
                    "name":    tool["name"],
                    "created": r.get("created", 0),
                    "updated": r.get("updated", 0),
                    "error":   None,
                })
                ran += 1
            except Exception as exc:
                results.append({
                    "id":      tool["id"],
                    "slug":    tool["slug"],
                    "name":    tool["name"],
                    "created": 0,
                    "updated": 0,
                    "error":   str(exc),
                })
    finally:
        conn.close()

    return {"results": results, "total_ran": ran, "total_skipped": len(candidates) - ran}


@router.post("/{project_id}/etl-run-all")
def etl_run_all(project_id: int):
    project = _get_project(project_id)
    conn = open_project_db(DATA_DIR / project["db_path"])
    try:
        rows = conn.execute(
            "SELECT id, slug, name, query_config FROM _tools ORDER BY id"
        ).fetchall()

        candidates = []
        for row in rows:
            cfg = json.loads(row["query_config"] or "{}")
            if cfg.get("etl_model"):
                candidates.append({
                    "id":       row["id"],
                    "slug":     row["slug"],
                    "name":     row["name"],
                    "etl_deps": cfg.get("etl_deps", []),
                    "model":    cfg["etl_model"],
                })

        ordered = _topo_sort(candidates)
        results = []
        ran = 0
        for tool in ordered:
            try:
                r = _etl.etl_apply(conn, tool["id"], tool["model"])
                conn.execute("UPDATE _tools SET is_stale = 0 WHERE id = ?", (tool["id"],))
                conn.commit()
                results.append({
                    "id":      tool["id"],
                    "slug":    tool["slug"],
                    "name":    tool["name"],
                    "created": r.get("created", 0),
                    "updated": r.get("updated", 0),
                    "error":   None,
                })
                ran += 1
            except Exception as exc:
                results.append({
                    "id":      tool["id"],
                    "slug":    tool["slug"],
                    "name":    tool["name"],
                    "created": 0,
                    "updated": 0,
                    "error":   str(exc),
                })
    finally:
        conn.close()

    return {"results": results, "total_ran": ran, "total_skipped": len(candidates) - ran}
