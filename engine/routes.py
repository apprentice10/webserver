"""
engine/routes.py
-----------------
Endpoints HTTP del Table Engine — thin layer su service.py ed etl.py.
"""

import json
import logging
import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

logger = logging.getLogger("engine.routes")

from engine.project_db import get_project_conn, audit
from engine import service, service_columns, service_row_ops, service_templates
from engine.catalog import TOOL_CATALOG
from engine.schemas import (
    ToolCreate, ToolSettingsUpdate, ToolResponse,
    TemplateCreate, TemplateResponse,
    ColumnCreate, ColumnUpdate, ColumnWidthUpdate, ColumnReorder, ColumnResponse,
    RowCreate, CellUpdate, PasteData,
    SqlQuery,
)

router = APIRouter(prefix="/api/tools", tags=["engine"])


# ============================================================
# HELPER — adatta il dict _tools al formato ToolResponse
# ============================================================

def _tool_to_response(tool: dict) -> dict:
    config = {}
    if tool.get("query_config"):
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            pass
    return {
        "id":          tool["id"],
        "name":        tool["name"],
        "slug":        tool["slug"],
        "tool_type":   tool.get("tool_type"),
        "current_rev": tool.get("rev", "A"),
        "note":        tool.get("note"),
        "icon":        tool.get("icon", "📄"),
        "is_stale":    bool(tool.get("is_stale", 0)),
        "has_etl":     bool(config.get("etl_sql", "").strip()),
    }


# ============================================================
# CATALOGO E TEMPLATE
# ============================================================

@router.get("/types")
def get_tool_types():
    return TOOL_CATALOG


@router.get("/templates", response_model=list[TemplateResponse])
def list_templates(
    type_slug: Optional[str] = Query(None),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return service_templates.get_templates(conn, type_slug)


@router.post("/templates", response_model=TemplateResponse)
def create_template(
    data: TemplateCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return service_templates.create_template(
        conn,
        type_slug=data.type_slug,
        name=data.name,
        etl_sql=data.etl_sql,
        description=data.description,
    )


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    service_templates.delete_template(conn, template_id)
    return {"ok": True}


# ============================================================
# TOOL
# ============================================================

@router.get("/project")
def list_tools(conn: sqlite3.Connection = Depends(get_project_conn)):
    tools = service.get_tools_for_project(conn)
    return [_tool_to_response(t) for t in tools]


@router.post("/project")
def create_tool(
    data: ToolCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.create_tool(
        conn=conn,
        name=data.name,
        slug=data.slug,
        tool_type=data.tool_type,
        icon=data.icon,
        template_id=data.template_id,
        default_columns=data.default_columns,
        etl_sql=data.etl_sql
    )
    return _tool_to_response(tool)


@router.get("/{tool_id}")
def get_tool(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    tool = service.get_tool(conn, tool_id)
    return _tool_to_response(tool)


@router.patch("/{tool_id}/settings")
def update_tool_settings(
    tool_id: int,
    data: ToolSettingsUpdate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    payload = data.model_dump(exclude_unset=True)
    if "current_rev" in payload and "rev" not in payload:
        payload["rev"] = payload.pop("current_rev")
    elif "current_rev" in payload:
        payload.pop("current_rev")
    tool = service.update_tool_settings(conn, tool_id, payload)
    return _tool_to_response(tool)


# ============================================================
# COLONNE
# ============================================================

@router.get("/{tool_id}/columns")
def list_columns(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    logger.debug("list_columns: tool_id=%s", tool_id)
    try:
        return service.get_columns(conn, tool_id)
    except Exception:
        logger.error("list_columns: failed for tool_id=%s", tool_id, exc_info=True)
        raise


@router.post("/{tool_id}/columns")
def add_column(
    tool_id: int,
    data: ColumnCreate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_columns.add_column(
        conn=conn,
        tool_id=tool_id,
        name=data.name,
        slug=data.slug,
        col_type=data.col_type,
        width=data.width,
        position=data.position
    )


@router.put("/{tool_id}/columns/reorder")
def reorder_columns(
    tool_id: int,
    data: ColumnReorder = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_columns.reorder_columns(conn, tool_id, data.order)


@router.patch("/{tool_id}/columns/{column_id}")
def update_column(
    tool_id: int,
    column_id: int,
    data: ColumnUpdate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_columns.update_column(
        conn, tool_id, column_id, data.model_dump(exclude_unset=True)
    )


@router.delete("/{tool_id}/columns/{column_id}")
def delete_column(
    tool_id: int,
    column_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_columns.delete_column(conn, tool_id, column_id)


@router.patch("/{tool_id}/columns/{column_id}/width")
def update_column_width(
    tool_id: int,
    column_id: int,
    data: ColumnWidthUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_columns.update_column_width(conn, tool_id, column_id, data.width)


# ============================================================
# RIGHE
# ============================================================

@router.get("/{tool_id}/rows")
def list_rows(
    tool_id: int,
    include_deleted: bool = Query(False),
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service.get_rows(conn, tool_id, None, include_deleted)


@router.post("/{tool_id}/rows")
def create_row(
    tool_id: int,
    data: RowCreate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service.create_row(conn, tool_id, None, data.cells)


@router.post("/{tool_id}/rows/paste")
def paste_rows(
    tool_id: int,
    data: PasteData = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_ops.paste_rows(conn, tool_id, None, data.rows)


@router.patch("/{tool_id}/rows/{row_id}/cell")
def update_cell(
    tool_id: int,
    row_id: int,
    data: CellUpdate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service.update_cell(conn, tool_id, row_id, None, data.slug, data.value)


@router.post("/{tool_id}/rows/{row_id}/delete")
def soft_delete_row(
    tool_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_ops.soft_delete_row(conn, tool_id, row_id, None)


@router.post("/{tool_id}/rows/{trash_id}/restore")
def restore_row(
    tool_id: int,
    trash_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_ops.restore_row(conn, tool_id, trash_id, None)


@router.delete("/{tool_id}/rows/{row_id}/override")
def remove_override(
    tool_id: int,
    row_id: int,
    col: str = Query(...),
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_ops.remove_override(conn, tool_id, row_id, col, None)


@router.post("/{tool_id}/rows/{row_id}/keep")
def keep_row(
    tool_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    tool = service.get_tool(conn, tool_id)
    slug = tool["slug"]
    row = conn.execute(f'SELECT tag FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    tag = row["tag"]
    flag = conn.execute("SELECT id FROM _flags WHERE name = 'ETL: Eliminated'").fetchone()
    if flag:
        conn.execute(
            "DELETE FROM _cell_flags WHERE tool_slug=? AND row_tag=? AND col_slug='' AND flag_id=?",
            (slug, tag, flag["id"])
        )
        audit(conn, slug, "KEEP_ROW", row_tag=tag)
        conn.commit()
    return {"kept": True, "row_tag": tag}


@router.get("/{tool_id}/audit")
def get_audit_log(
    tool_id:  int,
    row_tag:  Optional[str] = Query(None),
    row_tags:  Optional[str] = Query(None),
    col_slug:  Optional[str] = Query(None),
    col_slugs: Optional[str] = Query(None),
    limit:     int = Query(200),
    conn:      sqlite3.Connection = Depends(get_project_conn),
):
    tool      = service.get_tool(conn, tool_id)
    tool_slug = tool["slug"]
    conds:  list = ["tool_slug = ?"]
    params: list = [tool_slug]

    all_tags = [t.strip() for t in (row_tags or "").split(",") if t.strip()]
    if row_tag is not None:
        all_tags.append(row_tag)
    if all_tags:
        ph = ",".join("?" * len(all_tags))
        conds.append(f"row_tag IN ({ph})")
        params.extend(all_tags)

    all_cols = [c.strip() for c in (col_slugs or "").split(",") if c.strip()]
    if col_slug:
        all_cols.append(col_slug)
    if all_cols:
        ph = ",".join("?" * len(all_cols))
        conds.append(f"(col_slug IN ({ph}) OR field IN ({ph}))")
        params.extend(all_cols * 2)

    where = " AND ".join(conds)
    params.append(limit)
    rows = conn.execute(
        f"SELECT id, ts, action, change_type, row_tag, "
        f"COALESCE(col_slug, field) AS col_slug, old_val, new_val, revision "
        f"FROM _audit WHERE {where} ORDER BY id DESC LIMIT ?",
        params
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{tool_id}/rows/{row_id}/rollback")
def rollback_cell(
    tool_id:  int,
    row_id:   int,
    col:      str = Query(...),
    entry_id: int = Query(...),
    conn:     sqlite3.Connection = Depends(get_project_conn),
):
    return service_row_ops.rollback_cell(conn, tool_id, row_id, None, col, entry_id)


@router.post("/{tool_id}/rows/{row_id}/hard-delete")
def hard_delete_row(
    tool_id: int,
    row_id:  int,
    conn:    sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_ops.hard_delete_row(conn, tool_id, row_id, None)


# ============================================================
# SQL EDITOR
# ============================================================

@router.post("/{tool_id}/sql")
def run_sql(
    tool_id: int,
    data: SqlQuery = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    sql = data.sql.strip()
    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Operazione non permessa: '{keyword.strip()}'"
            )
    try:
        cur = conn.execute(sql)
        if cur.description:
            columns = [d[0] for d in cur.description]
            rows    = [dict(zip(columns, row)) for row in cur.fetchall()]
            return {"columns": columns, "rows": rows}
        conn.commit()
        return {"rowcount": cur.rowcount}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

