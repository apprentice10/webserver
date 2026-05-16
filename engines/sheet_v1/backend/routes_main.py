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

from dashboard.project_db import get_project_conn, audit
from . import service, service_columns, service_row_ops, service_row_position, service_templates
from dashboard.catalog import ENGINE_CATALOG, UTILITY_BY_CATEGORY
from .schemas import (
    EngineCreate, EngineSettingsUpdate, EnginePositionUpdate, EngineGroupUpdate,
    GroupCreate, GroupUpdate, EngineResponse,
    TemplateCreate, TemplateResponse,
    ColumnCreate, ColumnUpdate, ColumnWidthUpdate, ColumnReorder, ColumnResponse,
    RowCreate, CellUpdate, PasteData,
    SqlQuery, InsertRowRequest, ReorderRowRequest, SortFilterStateUpdate,
)

router = APIRouter(prefix="/api/engines", tags=["engine"])


# ============================================================
# HELPER — adatta il dict _tools al formato ToolResponse
# ============================================================

def _engine_to_response(tool: dict) -> dict:
    config = {}
    if tool.get("query_config"):
        try:
            config = json.loads(tool["query_config"])
        except Exception:
            pass
    return {
        "id":             tool["id"],
        "name":           tool["name"],
        "slug":           tool["slug"],
        "tool_type":      tool.get("tool_type"),
        "engine_version": tool.get("engine_version", "1.0"),
        "current_rev":    tool.get("rev", "A"),
        "note":           tool.get("note"),
        "icon":           tool.get("icon", "📄"),
        "is_stale":       bool(tool.get("is_stale", 0)),
        "has_etl":        bool(config.get("etl_sql", "").strip()),
        "group_id":       tool.get("group_id"),
        "position":       tool.get("position", 0),
    }


# ============================================================
# CATALOGO E TEMPLATE
# ============================================================

@router.get("/types")
def get_engine_types():
    return ENGINE_CATALOG


@router.get("/catalog")
def get_engine_catalog():
    """Returns only type=engine manifests — used by the +new Engine modal."""
    return ENGINE_CATALOG


@router.get("/utilities")
def get_utilities(category: Optional[str] = Query(None)):
    """Returns installed utility manifests, optionally filtered by utility_category."""
    if category:
        return UTILITY_BY_CATEGORY.get(category, [])
    utils = []
    for entries in UTILITY_BY_CATEGORY.values():
        utils.extend(entries)
    return utils


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

# ============================================================
# GROUPS
# ============================================================

@router.get("/groups")
def list_groups(conn: sqlite3.Connection = Depends(get_project_conn)):
    rows = conn.execute("SELECT * FROM _tool_groups ORDER BY position, id").fetchall()
    return [dict(r) for r in rows]


@router.post("/groups")
def create_group(
    data: GroupCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    max_pos = conn.execute("SELECT COALESCE(MAX(position), -1) FROM _tool_groups").fetchone()[0]
    conn.execute(
        "INSERT INTO _tool_groups (name, icon, position) VALUES (?, ?, ?)",
        (data.name, data.icon or "", max_pos + 1),
    )
    gid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    return dict(conn.execute("SELECT * FROM _tool_groups WHERE id = ?", (gid,)).fetchone())


@router.patch("/groups/{group_id}")
def update_group(
    group_id: int,
    data: GroupUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    if not conn.execute("SELECT 1 FROM _tool_groups WHERE id = ?", (group_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Group not found")
    payload = data.model_dump(exclude_unset=True)
    if not payload:
        return dict(conn.execute("SELECT * FROM _tool_groups WHERE id = ?", (group_id,)).fetchone())
    sets = ", ".join(f"{k} = ?" for k in payload)
    conn.execute(f"UPDATE _tool_groups SET {sets} WHERE id = ?", [*payload.values(), group_id])
    conn.commit()
    return dict(conn.execute("SELECT * FROM _tool_groups WHERE id = ?", (group_id,)).fetchone())


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    conn.execute("UPDATE _tools SET group_id = NULL WHERE group_id = ?", (group_id,))
    conn.execute("DELETE FROM _tool_groups WHERE id = ?", (group_id,))
    conn.commit()
    return {"ok": True}


@router.patch("/{tool_id}/group")
def update_engine_group(
    tool_id: int,
    data: EngineGroupUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    service.get_engine(conn, tool_id)
    conn.execute("UPDATE _tools SET group_id = ? WHERE id = ?", (data.group_id, tool_id))
    conn.commit()
    return {"ok": True}


# ============================================================
# TOOL
# ============================================================

@router.get("/project")
def list_engines(conn: sqlite3.Connection = Depends(get_project_conn)):
    tools = service.get_engines_for_project(conn)
    return [_engine_to_response(t) for t in tools]


@router.post("/project")
def create_engine(
    data: EngineCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.create_engine(
        conn=conn,
        name=data.name,
        slug=data.slug,
        tool_type=data.tool_type,
        engine_version=data.engine_version,
        icon=data.icon,
        template_id=data.template_id,
        default_columns=data.default_columns,
        etl_sql=data.etl_sql
    )
    return _engine_to_response(tool)


@router.get("/trash")
def list_trash(conn: sqlite3.Connection = Depends(get_project_conn)):
    rows = conn.execute(
        "SELECT * FROM _tools WHERE is_trashed = 1 ORDER BY trashed_at DESC"
    ).fetchall()
    return [_engine_to_response(dict(r)) for r in rows]


@router.patch("/{tool_id}/position")
def update_engine_position(
    tool_id: int,
    data: EnginePositionUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    service.get_engine(conn, tool_id)
    all_tools = conn.execute("SELECT id FROM _tools ORDER BY position, id").fetchall()
    ids = [r[0] for r in all_tools]
    if tool_id not in ids:
        raise HTTPException(status_code=404, detail="Engine not found")
    ids.remove(tool_id)
    new_pos = max(0, min(data.position, len(ids)))
    ids.insert(new_pos, tool_id)
    for idx, tid in enumerate(ids):
        conn.execute("UPDATE _tools SET position = ? WHERE id = ?", (idx, tid))
    conn.commit()
    return {"ok": True}


@router.get("/{tool_id}")
def get_engine(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    tool = service.get_engine(conn, tool_id)
    return _engine_to_response(tool)


@router.patch("/{tool_id}/settings")
def update_engine_settings(
    tool_id: int,
    data: EngineSettingsUpdate = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    payload = data.model_dump(exclude_unset=True)
    if "current_rev" in payload and "rev" not in payload:
        payload["rev"] = payload.pop("current_rev")
    elif "current_rev" in payload:
        payload.pop("current_rev")
    tool = service.update_engine_settings(conn, tool_id, payload)
    return _engine_to_response(tool)


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
    tool = service.get_engine(conn, tool_id)
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


@router.post("/{tool_id}/rows/{row_id}/insert")
def insert_row_at_position(
    tool_id: int,
    row_id: int,
    data: InsertRowRequest = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_position.insert_row_at_position(
        conn, tool_id, row_id, data.placement, None
    )


@router.post("/{tool_id}/rows/{row_id}/copy-insert")
def copy_row_insert(
    tool_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_position.copy_row_insert(conn, tool_id, row_id, None)


@router.post("/{tool_id}/rows/{row_id}/reorder")
def reorder_row(
    tool_id: int,
    row_id: int,
    data: ReorderRowRequest = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    return service_row_position.reorder_row(
        conn, tool_id, row_id, data.anchor_row_id, data.placement, None
    )


# ============================================================
# TRASH / SOFT-DELETE
# ============================================================

@router.get("/{tool_id}/dependents")
def get_engine_dependents(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    from dashboard.sql_parser import extract_table_refs
    tool = service.get_engine(conn, tool_id)
    slug = tool["slug"]
    other_tools = conn.execute(
        "SELECT id, name, slug, query_config FROM _tools WHERE id != ? AND (is_trashed = 0 OR is_trashed IS NULL)",
        (tool_id,)
    ).fetchall()
    dependents = []
    for t in other_tools:
        cfg = json.loads(t["query_config"] or "{}")
        etl_sql = cfg.get("etl_sql", "") or ""
        if slug in extract_table_refs(etl_sql):
            dependents.append({"id": t["id"], "name": t["name"], "slug": t["slug"]})
    return dependents


@router.delete("/{tool_id}")
def soft_delete_engine(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    from dashboard.utils import now_str
    service.get_engine(conn, tool_id)
    conn.execute(
        "UPDATE _tools SET is_trashed = 1, trashed_at = ?, group_id = NULL WHERE id = ?",
        (now_str(), tool_id),
    )
    conn.commit()
    return {"ok": True}


@router.post("/{tool_id}/restore")
def restore_engine(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    conn.execute(
        "UPDATE _tools SET is_trashed = 0, trashed_at = NULL, group_id = NULL WHERE id = ?",
        (tool_id,),
    )
    conn.commit()
    return {"ok": True}


@router.delete("/{tool_id}/permanent")
def permanent_delete_engine(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.get_engine(conn, tool_id)
    slug = tool["slug"]
    try:
        conn.execute(f'DROP TABLE IF EXISTS "{slug}"')
    except Exception:
        pass
    conn.execute("DELETE FROM _columns WHERE tool_id = ?", (tool_id,))
    conn.execute("DELETE FROM _templates WHERE type_slug = ?", (slug,))
    conn.execute("DELETE FROM _tools WHERE id = ?", (tool_id,))
    conn.commit()
    return {"ok": True}


@router.get("/{tool_id}/audit")
def get_audit_log(
    tool_id:  int,
    row_tag:  Optional[str] = Query(None),
    row_tags:  Optional[str] = Query(None),
    col_slug:  Optional[str] = Query(None),
    col_slugs: Optional[str] = Query(None),
    limit:     int = Query(200),
    revision:  Optional[int] = Query(None),
    conn:      sqlite3.Connection = Depends(get_project_conn),
):
    tool      = service.get_engine(conn, tool_id)
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

    if revision is not None:
        conds.append("revision = ?")
        params.append(str(revision))

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
# SORT / FILTER STATE
# ============================================================

@router.get("/{tool_id}/sort-filter-state")
def get_sort_filter_state(
    tool_id: int,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    row = conn.execute("SELECT sort_filter_state FROM _tools WHERE id = ?", (tool_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    raw = row[0]
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            return {"sort": [], "filters": {}}
    return {"sort": [], "filters": {}}


@router.patch("/{tool_id}/sort-filter-state")
def set_sort_filter_state(
    tool_id: int,
    data:    SortFilterStateUpdate,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    if not conn.execute("SELECT 1 FROM _tools WHERE id = ?", (tool_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Tool not found")
    conn.execute(
        "UPDATE _tools SET sort_filter_state = ? WHERE id = ?",
        (json.dumps({"sort": data.sort, "filters": data.filters}), tool_id),
    )
    conn.commit()
    return {"ok": True}


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
