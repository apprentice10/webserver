"""
engine/routes.py
-----------------
Endpoints HTTP universali del Table Engine.

Responsabilità SOLO:
- Ricevere e validare input HTTP (Pydantic)
- Delegare al service.py
- Restituire risposte HTTP

Struttura URL:
  /api/tools/                          GET  — lista tool del progetto
  /api/tools/                          POST — crea nuovo tool
  /api/tools/{tool_id}/                GET  — dettaglio tool
  /api/tools/{tool_id}/settings        PATCH — aggiorna settings tool
  /api/tools/{tool_id}/columns         GET  — lista colonne
  /api/tools/{tool_id}/columns         POST — aggiungi colonna
  /api/tools/{tool_id}/columns/{id}    PATCH — modifica colonna
  /api/tools/{tool_id}/columns/{id}    DELETE — elimina colonna
  /api/tools/{tool_id}/columns/{id}/width PATCH — resize colonna
  /api/tools/{tool_id}/rows            GET  — lista righe
  /api/tools/{tool_id}/rows            POST — crea riga
  /api/tools/{tool_id}/rows/paste      POST — incolla righe multiple
  /api/tools/{tool_id}/rows/{id}/cell  PATCH — aggiorna cella
  /api/tools/{tool_id}/rows/{id}/delete POST — soft delete
  /api/tools/{tool_id}/rows/{id}/restore POST — ripristina riga
  /api/tools/{tool_id}/sql             POST — SQL editor
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any
import sqlalchemy

from database import get_db
from engine import service

router = APIRouter(prefix="/api/tools", tags=["engine"])


# ============================================================
# SCHEMI PYDANTIC
# ============================================================

class ToolCreate(BaseModel):
    name:            str
    slug:            str
    icon:            Optional[str] = "📄"
    default_columns: Optional[list[dict]] = None


class ToolSettingsUpdate(BaseModel):
    name:         Optional[str] = None
    current_rev:  Optional[str] = None
    note:         Optional[str] = None
    query_config: Optional[Any] = None


class ToolResponse(BaseModel):
    id:          int
    project_id:  int
    name:        str
    slug:        str
    current_rev: str
    note:        Optional[str]
    icon:        Optional[str]

    class Config:
        from_attributes = True


class ColumnCreate(BaseModel):
    name:     str
    slug:     str
    col_type: Optional[str] = "text"
    width:    Optional[int] = 120
    position: Optional[int] = None


class ColumnUpdate(BaseModel):
    name:     Optional[str] = None
    width:    Optional[int] = None
    position: Optional[int] = None
    col_type: Optional[str] = None
    formula:  Optional[str] = None


class ColumnWidthUpdate(BaseModel):
    width: int


class ColumnResponse(BaseModel):
    id:        int
    tool_id:   int
    name:      str
    slug:      str
    col_type:  str
    width:     int
    position:  int
    is_system: bool
    formula:   Optional[str]

    class Config:
        from_attributes = True


class RowCreate(BaseModel):
    cells: dict[str, Any]  # {slug: valore}


class CellUpdate(BaseModel):
    slug:  str
    value: Optional[str] = None


class PasteData(BaseModel):
    rows: list[dict[str, Any]]  # lista di {slug: valore}


class SqlQuery(BaseModel):
    sql: str


# ============================================================
# ROUTE — TOOL
# ============================================================

@router.get("/project/{project_id}", response_model=list[ToolResponse])
def list_tools(project_id: int, db: Session = Depends(get_db)):
    """Restituisce tutti i tool di un progetto."""
    return service.get_tools_for_project(db, project_id)


@router.post("/project/{project_id}", response_model=ToolResponse)
def create_tool(project_id: int, data: ToolCreate, db: Session = Depends(get_db)):
    """Crea un nuovo tool per il progetto."""
    return service.create_tool(
        db=db,
        project_id=project_id,
        name=data.name,
        slug=data.slug,
        icon=data.icon,
        default_columns=data.default_columns
    )


@router.get("/{tool_id}", response_model=ToolResponse)
def get_tool(
    tool_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Restituisce il dettaglio di un tool."""
    return service.get_tool(db, tool_id, project_id)


@router.patch("/{tool_id}/settings", response_model=ToolResponse)
def update_tool_settings(
    tool_id: int,
    project_id: int = Query(...),
    data: ToolSettingsUpdate = ...,
    db: Session = Depends(get_db)
):
    """Aggiorna le impostazioni di un tool."""
    return service.update_tool_settings(
        db, tool_id, project_id,
        data.model_dump(exclude_unset=True)
    )


# ============================================================
# ROUTE — COLONNE
# ============================================================

@router.get("/{tool_id}/columns", response_model=list[ColumnResponse])
def list_columns(
    tool_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Restituisce le colonne di un tool."""
    return service.get_columns(db, tool_id)


@router.post("/{tool_id}/columns", response_model=ColumnResponse)
def add_column(
    tool_id: int,
    project_id: int = Query(...),
    data: ColumnCreate = ...,
    db: Session = Depends(get_db)
):
    """Aggiunge una nuova colonna al tool."""
    return service.add_column(
        db=db,
        tool_id=tool_id,
        project_id=project_id,
        name=data.name,
        slug=data.slug,
        col_type=data.col_type,
        width=data.width,
        position=data.position
    )


@router.patch("/{tool_id}/columns/{column_id}", response_model=ColumnResponse)
def update_column(
    tool_id: int,
    column_id: int,
    project_id: int = Query(...),
    data: ColumnUpdate = ...,
    db: Session = Depends(get_db)
):
    """Modifica una colonna esistente."""
    return service.update_column(
        db, tool_id, column_id, project_id,
        data.model_dump(exclude_unset=True)
    )


@router.delete("/{tool_id}/columns/{column_id}")
def delete_column(
    tool_id: int,
    column_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Elimina una colonna e tutte le sue celle."""
    return service.delete_column(db, tool_id, column_id, project_id)


@router.patch("/{tool_id}/columns/{column_id}/width", response_model=ColumnResponse)
def update_column_width(
    tool_id: int,
    column_id: int,
    data: ColumnWidthUpdate,
    db: Session = Depends(get_db)
):
    """Aggiorna solo la larghezza di una colonna (resize)."""
    return service.update_column_width(db, tool_id, column_id, data.width)


# ============================================================
# ROUTE — RIGHE
# ============================================================

@router.get("/{tool_id}/rows")
def list_rows(
    tool_id: int,
    project_id: int = Query(...),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Restituisce le righe del tool."""
    return service.get_rows(db, tool_id, include_deleted)


@router.post("/{tool_id}/rows")
def create_row(
    tool_id: int,
    project_id: int = Query(...),
    data: RowCreate = ...,
    db: Session = Depends(get_db)
):
    """Crea una nuova riga."""
    return service.create_row(db, tool_id, project_id, data.cells)


@router.post("/{tool_id}/rows/paste")
def paste_rows(
    tool_id: int,
    project_id: int = Query(...),
    data: PasteData = ...,
    db: Session = Depends(get_db)
):
    """Incolla righe multiple (da Excel/CSV)."""
    return service.paste_rows(db, tool_id, project_id, data.rows)


@router.patch("/{tool_id}/rows/{row_id}/cell")
def update_cell(
    tool_id: int,
    row_id: int,
    project_id: int = Query(...),
    data: CellUpdate = ...,
    db: Session = Depends(get_db)
):
    """Aggiorna il valore di una singola cella."""
    return service.update_cell(
        db, tool_id, row_id, project_id,
        data.slug, data.value
    )


@router.post("/{tool_id}/rows/{row_id}/delete")
def soft_delete_row(
    tool_id: int,
    row_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Soft delete: marca la riga come eliminata."""
    return service.soft_delete_row(db, tool_id, row_id, project_id)


@router.post("/{tool_id}/rows/{row_id}/restore")
def restore_row(
    tool_id: int,
    row_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Ripristina una riga soft-deleted."""
    return service.restore_row(db, tool_id, row_id, project_id)

@router.post("/{tool_id}/rows/{row_id}/hard-delete")
def hard_delete_row(
    tool_id: int,
    row_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Eliminazione definitiva — solo su righe già soft-deleted."""
    return service.hard_delete_row(db, tool_id, row_id, project_id)

# ============================================================
# ROUTE — SQL EDITOR
# ============================================================

@router.post("/{tool_id}/sql")
def run_sql(
    tool_id: int,
    project_id: int = Query(...),
    data: SqlQuery = ...,
    db: Session = Depends(get_db)
):
    """
    Esegue una query SQL sul database.
    Blocca operazioni DDL pericolose.
    """
    sql = data.sql.strip()

    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=403,
                detail=f"Operazione non permessa: '{keyword.strip()}'"
            )

    try:
        result = db.execute(sqlalchemy.text(sql))

        if result.returns_rows:
            columns = list(result.keys())
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
            return {"columns": columns, "rows": rows}

        db.commit()
        return {"rowcount": result.rowcount}

    except Exception as e:
        db.rollback()
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))

# ============================================================
# SCHEMI ETL
# ============================================================

class EtlQuery(BaseModel):
    sql:   str
    label: Optional[str] = None


# ============================================================
# ROUTE — ETL
# ============================================================

@router.post("/{tool_id}/etl/preview")
def etl_preview(
    tool_id: int,
    project_id: int = Query(...),
    data: EtlQuery = ...,
    db: Session = Depends(get_db)
):
    """Anteprima risultati query ETL senza modificare il DB."""
    from engine.etl import etl_preview as _preview
    return _preview(db, tool_id, project_id, data.sql)


@router.post("/{tool_id}/etl/apply")
def etl_apply(
    tool_id: int,
    project_id: int = Query(...),
    data: EtlQuery = ...,
    db: Session = Depends(get_db)
):
    """Applica la query ETL — merge con dati esistenti."""
    from engine.etl import etl_apply as _apply
    return _apply(db, tool_id, project_id, data.sql)


@router.post("/{tool_id}/etl/save")
def etl_save(
    tool_id: int,
    project_id: int = Query(...),
    data: EtlQuery = ...,
    db: Session = Depends(get_db)
):
    """Salva la query ETL nello storico versioni."""
    from engine.etl import save_etl_version
    return save_etl_version(db, tool_id, project_id, data.sql, data.label)


@router.get("/{tool_id}/etl/config")
def etl_config(
    tool_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Restituisce configurazione ETL e storico versioni."""
    from engine.etl import get_etl_config
    return get_etl_config(db, tool_id, project_id)


@router.get("/{tool_id}/etl/schema")
def etl_schema(
    tool_id: int,
    project_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """
    Restituisce lo schema del database utile per scrivere query ETL.

    Include:
    - Tabelle DB native rilevanti (tool_rows, tool_cells, tool_columns, projects)
    - Tool del progetto con le loro colonne user-defined e view name
    """
    from engine.models import ToolColumn

    # Tabelle native con colonne utili per ETL
    native_tables = [
        {
            "name": "tool_rows",
            "label": "tool_rows",
            "type": "native",
            "columns": [
                {"name": "id",         "type": "INTEGER"},
                {"name": "tool_id",    "type": "INTEGER"},
                {"name": "project_id", "type": "INTEGER"},
                {"name": "position",   "type": "INTEGER"},
                {"name": "rev",        "type": "TEXT"},
                {"name": "is_deleted", "type": "BOOLEAN"},
                {"name": "row_log",    "type": "TEXT"},
                {"name": "created_at", "type": "DATETIME"},
                {"name": "updated_at", "type": "DATETIME"},
            ]
        },
        {
            "name": "tool_cells",
            "label": "tool_cells",
            "type": "native",
            "columns": [
                {"name": "id",            "type": "INTEGER"},
                {"name": "row_id",        "type": "INTEGER"},
                {"name": "column_id",     "type": "INTEGER"},
                {"name": "value",         "type": "TEXT"},
                {"name": "is_overridden", "type": "BOOLEAN"},
            ]
        },
        {
            "name": "tool_columns",
            "label": "tool_columns",
            "type": "native",
            "columns": [
                {"name": "id",        "type": "INTEGER"},
                {"name": "tool_id",   "type": "INTEGER"},
                {"name": "name",      "type": "TEXT"},
                {"name": "slug",      "type": "TEXT"},
                {"name": "position",  "type": "INTEGER"},
                {"name": "is_system", "type": "BOOLEAN"},
            ]
        },
        {
            "name": "tools",
            "label": "tools",
            "type": "native",
            "columns": [
                {"name": "id",          "type": "INTEGER"},
                {"name": "project_id",  "type": "INTEGER"},
                {"name": "name",        "type": "TEXT"},
                {"name": "slug",        "type": "TEXT"},
                {"name": "current_rev", "type": "TEXT"},
            ]
        },
        {
            "name": "projects",
            "label": "projects",
            "type": "native",
            "columns": [
                {"name": "id",          "type": "INTEGER"},
                {"name": "name",        "type": "TEXT"},
                {"name": "client",      "type": "TEXT"},
                {"name": "description", "type": "TEXT"},
            ]
        },
    ]

    # Tool del progetto con le loro colonne user-defined
    project_tools = service.get_tools_for_project(db, project_id)
    tool_schemas = []

    for t in project_tools:
        cols = db.query(ToolColumn).filter(
            ToolColumn.tool_id == t.id
        ).order_by(ToolColumn.position).all()

        tool_schemas.append({
            "name":    f"tool_{t.id}",
            "label":   t.name,
            "type":    "tool",
            "tool_id": t.id,
            "icon":    t.icon or "📄",
            "columns": [
                {
                    "name":      c.slug,
                    "label":     c.name,
                    "type":      c.col_type,
                    "is_system": c.is_system
                }
                for c in cols
            ]
        })

    return {
        "native_tables": native_tables,
        "tool_tables":   tool_schemas
    }