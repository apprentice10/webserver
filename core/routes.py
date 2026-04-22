from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from core.models import Project, ProjectSettings

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ============================================================
# SCHEMI PYDANTIC
# ============================================================

class ProjectCreate(BaseModel):
    name: str
    client: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    client: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    """Restituisce la lista di tutti i progetti."""
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.post("/", response_model=ProjectResponse)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    """Crea un nuovo progetto e lo salva nel database."""
    project = Project(
        name=data.name,
        client=data.client,
        description=data.description
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)):
    """Restituisce i dettagli di un singolo progetto."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """Elimina un progetto e tutti i suoi dati collegati."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")
    db.delete(project)
    db.commit()
    return {"ok": True, "deleted_id": project_id}