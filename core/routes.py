import re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

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
