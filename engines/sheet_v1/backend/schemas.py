"""
Sheet V1 Pydantic request/response schemas.
"""

from pydantic import BaseModel
from typing import Optional, Any, Literal
from datetime import datetime


class EngineCreate(BaseModel):
    name:            str
    slug:            Optional[str] = None
    tool_type:       Optional[str] = None
    engine_version:  Optional[str] = None
    icon:            Optional[str] = "📄"
    template_id:     Optional[int] = None
    default_columns: Optional[list[dict]] = None
    etl_sql:         Optional[str] = None


class EnginePositionUpdate(BaseModel):
    position: int


class EngineGroupUpdate(BaseModel):
    group_id: Optional[int] = None


class GroupCreate(BaseModel):
    name: str
    icon: Optional[str] = ""


class GroupUpdate(BaseModel):
    name:         Optional[str] = None
    icon:         Optional[str] = None
    position:     Optional[int] = None
    is_collapsed: Optional[int] = None


class EngineSettingsUpdate(BaseModel):
    name:         Optional[str] = None
    rev:          Optional[str] = None
    current_rev:  Optional[str] = None
    note:         Optional[str] = None
    query_config: Optional[Any] = None
    icon:         Optional[str] = None


class EngineResponse(BaseModel):
    id:             int
    name:           str
    slug:           str
    tool_type:      Optional[str]
    engine_version: str
    current_rev:    str
    note:           Optional[str]
    icon:           Optional[str]

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
    order: list[int]


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
    note:    str = ""


class CellFlagNoteUpdate(BaseModel):
    flag_id: int
    cells:   list[CellFlagEntry]
    note:    str


class ConditionalFlagRuleCreate(BaseModel):
    col_slug: str
    flag_id:  int
    operator: str  # contains|equals|is_empty|starts_with|matches_wildcard
    value:    str = ""


class InsertRowRequest(BaseModel):
    placement: Literal["above", "below"]


class ReorderRowRequest(BaseModel):
    anchor_row_id: int
    placement:     Literal["before", "after"]


class FindReplaceRequest(BaseModel):
    search:           str
    replacement:      str
    match_case:       bool = False
    match_entire_cell: bool = False
    scope:            Optional[list[dict]] = None  # [{row_id, col_slug}]; None = full sheet


class SortFilterStateUpdate(BaseModel):
    sort:    list[dict] = []
    filters: dict       = {}


class BatchCellItem(BaseModel):
    row_id:   int
    col_slug: str
    value:    Optional[str] = None


class BatchCellUpdate(BaseModel):
    cells: list[BatchCellItem]


class BatchRowOp(BaseModel):
    operation: Literal["soft_delete", "hard_delete", "restore", "keep"]
    row_ids: list[int]


class BatchRemoveOverride(BaseModel):
    cells: list[BatchCellItem]  # row_id + col_slug; value ignored
