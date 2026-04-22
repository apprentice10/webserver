"""
tools/instrument_list/routes.py
--------------------------------
Endpoints HTTP per il tool Instrument List.

Responsabilità SOLO:
- Ricevere e validare input HTTP (Pydantic)
- Delegare al service.py
- Restituire risposte HTTP

Nessuna logica di business qui.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from tools.instrument_list import service

router = APIRouter(prefix="/api/instrument-list", tags=["instrument-list"])
templates = Jinja2Templates(directory="templates")


# ============================================================
# SCHEMI PYDANTIC
# ============================================================

class RowCreate(BaseModel):
    tag:      str
    fase:     Optional[str] = None
    pid:      Optional[str] = None
    servizio: Optional[str] = None
    tipo:     Optional[str] = None
    standard: Optional[str] = None
    classe:   Optional[str] = None
    attacco:  Optional[str] = None
    range:    Optional[str] = None
    note:     Optional[str] = None


class RowUpdate(BaseModel):
    rev:      Optional[str] = None
    fase:     Optional[str] = None
    pid:      Optional[str] = None
    tag:      Optional[str] = None
    servizio: Optional[str] = None
    tipo:     Optional[str] = None
    standard: Optional[str] = None
    classe:   Optional[str] = None
    attacco:  Optional[str] = None
    range:    Optional[str] = None
    note:     Optional[str] = None


class RowResponse(BaseModel):
    id:        int
    project_id: int
    rev:       Optional[str]
    fase:      Optional[str]
    pid:       Optional[str]
    tag:       str
    servizio:  Optional[str]
    tipo:      Optional[str]
    standard:  Optional[str]
    classe:    Optional[str]
    attacco:   Optional[str]
    range:     Optional[str]
    note:      Optional[str]
    row_log:   Optional[str]

    class Config:
        from_attributes = True


class NoteUpdate(BaseModel):
    content: str


class NoteResponse(BaseModel):
    project_id: int
    content:    Optional[str]

    class Config:
        from_attributes = True


class RevUpdate(BaseModel):
    rev: str


class RevResponse(BaseModel):
    project_id:  int
    current_rev: str

    class Config:
        from_attributes = True


class SqlQuery(BaseModel):
    sql: str


# ============================================================
# ROUTE — PAGINA HTML
# ============================================================

@router.get("/view/{project_id}", response_class=HTMLResponse)
async def instrument_list_page(request: Request, project_id: int):
    """Restituisce la pagina HTML del tool per il progetto dato."""
    return templates.TemplateResponse(
        request,
        "tools/instrument_list.html",
        {"request": request, "project_id": project_id}
    )


# ============================================================
# ROUTE — RIGHE
# ============================================================

@router.get("/{project_id}/rows", response_model=list[RowResponse])
def list_rows(project_id: int, db: Session = Depends(get_db)):
    """Restituisce tutte le righe del progetto."""
    return service.get_all_rows(db, project_id)


@router.post("/{project_id}/rows", response_model=RowResponse)
def create_row(project_id: int, data: RowCreate, db: Session = Depends(get_db)):
    """Crea una nuova riga nella lista strumenti."""
    return service.create_row(db, project_id, data.model_dump())


@router.patch("/{project_id}/rows/{row_id}", response_model=RowResponse)
def update_row(project_id: int, row_id: int, data: RowUpdate, db: Session = Depends(get_db)):
    """Aggiorna uno o più campi di una riga esistente."""
    return service.update_row(db, project_id, row_id, data.model_dump(exclude_unset=True))


@router.delete("/{project_id}/rows/{row_id}")
def delete_row(project_id: int, row_id: int, db: Session = Depends(get_db)):
    """Elimina una riga dalla lista strumenti."""
    return service.delete_row(db, project_id, row_id)


# ============================================================
# ROUTE — NOTA
# ============================================================

@router.get("/{project_id}/note", response_model=NoteResponse)
def get_note(project_id: int, db: Session = Depends(get_db)):
    """Restituisce la nota del tool per il progetto."""
    return service.get_note(db, project_id)


@router.patch("/{project_id}/note", response_model=NoteResponse)
def update_note(project_id: int, data: NoteUpdate, db: Session = Depends(get_db)):
    """Aggiorna la nota del tool."""
    return service.update_note(db, project_id, data.content)


# ============================================================
# ROUTE — REVISIONE
# ============================================================

@router.get("/{project_id}/rev", response_model=RevResponse)
def get_rev(project_id: int, db: Session = Depends(get_db)):
    """Restituisce la revisione attiva del progetto."""
    return service.get_or_create_rev(db, project_id)


@router.patch("/{project_id}/rev", response_model=RevResponse)
def update_rev(project_id: int, data: RevUpdate, db: Session = Depends(get_db)):
    """Aggiorna la revisione attiva del progetto."""
    return service.set_rev(db, project_id, data.rev)


# ============================================================
# ROUTE — SQL EDITOR
# ============================================================

@router.post("/{project_id}/sql")
def run_sql(project_id: int, data: SqlQuery, db: Session = Depends(get_db)):
    """
    Esegue una query SQL sul database del progetto.
    Permette SELECT, INSERT, UPDATE, DELETE.
    Blocca operazioni pericolose (DROP, ALTER, TRUNCATE).
    """
    sql = data.sql.strip()

    # Blocca operazioni DDL pericolose
    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Operazione non permessa: '{keyword.strip()}'"
            )

    try:
        result = db.execute(__import__("sqlalchemy").text(sql))

        # SELECT — restituisce righe e colonne
        if result.returns_rows:
            columns = list(result.keys())
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
            return {"columns": columns, "rows": rows}

        # INSERT/UPDATE/DELETE — restituisce righe interessate
        db.commit()
        return {"rowcount": result.rowcount}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))