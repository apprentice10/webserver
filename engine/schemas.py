"""
engine/schemas.py
------------------
Pydantic request/response schemas for all engine API endpoints.
"""

from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class ToolCreate(BaseModel):
    name:            str
    slug:            Optional[str] = None
    tool_type:       Optional[str] = None
    icon:            Optional[str] = "📄"
    template_id:     Optional[int] = None
    default_columns: Optional[list[dict]] = None
    etl_sql:         Optional[str] = None


class ToolSettingsUpdate(BaseModel):
    name:         Optional[str] = None
    rev:          Optional[str] = None
    current_rev:  Optional[str] = None   # alias for backward compat
    note:         Optional[str] = None
    query_config: Optional[Any] = None
    icon:         Optional[str] = None


class ToolResponse(BaseModel):
    id:          int
    name:        str
    slug:        str
    tool_type:   Optional[str]
    current_rev: str
    note:        Optional[str]
    icon:        Optional[str]

    class Config:
        from_attributes = True


class TemplateCreate(BaseModel):
    type_slug:   str
    name:        str
    description: Optional[str] = None
    etl_sql:     str
    tool_id:     Optional[int] = None


class TemplateResponse(BaseModel):
    id:          int
    type_slug:   str
    name:        str
    description: Optional[str]
    etl_sql:     str
    created_at:  Optional[datetime]
    tool_id:     Optional[int] = None

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


class ColumnReorder(BaseModel):
    order: list[int]   # user column IDs in new order


class ColumnResponse(BaseModel):
    id:        int
    tool_id:   int
    name:      str
    slug:      str
    col_type:  str
    width:     int
    position:  int
    is_system: bool
    formula:   Optional[str] = None

    class Config:
        from_attributes = True


class RowCreate(BaseModel):
    cells: dict[str, Any]


class CellUpdate(BaseModel):
    slug:  str
    value: Optional[str] = None


class PasteData(BaseModel):
    rows: list[dict[str, Any]]


class SqlQuery(BaseModel):
    sql: str


class EtlModelBody(BaseModel):
    model: dict
    label: Optional[str] = None


class EtlSqlImportBody(BaseModel):
    sql: str


class FlagCreate(BaseModel):
    name:  str
    color: str = "#888888"


class FlagUpdate(BaseModel):
    name:  Optional[str] = None
    color: Optional[str] = None


class CellFlagEntry(BaseModel):
    row_tag:  str
    col_slug: str = ""


class CellFlagToggleRequest(BaseModel):
    flag_id: int
    cells:   list[CellFlagEntry]
