"""
engine/routes_etl.py
---------------------
ETL endpoints. Extracted from engine/routes.py (P3-003).
"""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException

from dashboard.project_db import get_project_conn
from dashboard.schemas import EtlModelBody, EtlSqlImportBody

router = APIRouter(prefix="/api/engines", tags=["engine"])


@router.post("/{tool_id}/etl/compile")
def etl_compile(
    tool_id: int,
    data: EtlModelBody = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl_compiler import compile_sql, EtlValidationError, EtlCompilationError
    try:
        sql = compile_sql(data.model)
    except (EtlValidationError, EtlCompilationError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"sql": sql}


@router.post("/{tool_id}/etl/preview")
def etl_preview(
    tool_id: int,
    data: EtlModelBody = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import etl_preview as _preview
    return _preview(conn, tool_id, data.model)


@router.post("/{tool_id}/etl/apply")
def etl_apply(
    tool_id: int,
    data: EtlModelBody = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import etl_apply as _apply
    return _apply(conn, tool_id, data.model)


@router.post("/{tool_id}/etl/run")
def etl_run(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import etl_run_saved
    return etl_run_saved(conn, tool_id)


@router.post("/{tool_id}/etl/save")
def etl_save(
    tool_id: int,
    data: EtlModelBody = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import save_etl_version
    return save_etl_version(conn, tool_id, data.model, data.label)


@router.get("/{tool_id}/etl/config")
def etl_config(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import get_etl_config
    return get_etl_config(conn, tool_id)


@router.patch("/{tool_id}/etl/config")
def etl_save_draft(
    tool_id: int,
    data: EtlModelBody = ...,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import etl_save_draft as _save_draft
    return _save_draft(conn, tool_id, data.model)


@router.post("/{tool_id}/etl/sql_to_model")
def etl_sql_to_model(
    tool_id: int,
    data: EtlSqlImportBody = ...,
):
    from dashboard.sql_to_model import sql_to_model
    try:
        model = sql_to_model(data.sql)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"model": model}


@router.get("/{tool_id}/etl/schema")
def etl_schema(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn)
):
    from dashboard.etl import get_etl_schema
    return get_etl_schema(conn, tool_id)
