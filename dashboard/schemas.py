"""
dashboard/schemas.py
---------------------
Shared Pydantic schemas for dashboard infrastructure (ETL endpoints).
Sheet-specific schemas live in engines/sheet_v1/backend/schemas.py.
"""

from pydantic import BaseModel
from typing import Optional, Any


class EtlModelBody(BaseModel):
    model: dict
    label: Optional[str] = None


class EtlSqlImportBody(BaseModel):
    sql: str
