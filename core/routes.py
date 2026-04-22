from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from core.models import Project
from engine.project_db import create_project_db, DATA_DIR

router = APIRouter(prefix="/api/projects", tags=["projects"])


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
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.post("/", response_model=ProjectResponse)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    base_name = Project.make_db_filename(data.client or "", data.name)

    # Garantisce unicità del filename
    db_filename = base_name
    counter = 1
    while db.query(Project).filter(Project.db_path == db_filename).first():
        stem = base_name[:-3]
        db_filename = f"{stem}_{counter}.db"
        counter += 1

    project = Project(
        name=data.name,
        client=data.client,
        description=data.description,
        db_path=db_filename
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    # Crea il file DB del progetto
    create_project_db(DATA_DIR / db_filename)

    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")

    # Elimina il file DB del progetto
    db_path = DATA_DIR / project.db_path
    if db_path.exists():
        db_path.unlink()

    db.delete(project)
    db.commit()
    return {"ok": True, "deleted_id": project_id}
