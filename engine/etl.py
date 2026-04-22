"""
engine/etl.py
--------------
Motore ETL per il Table Engine.

Responsabilità:
- Esecuzione query SQL ETL
- Preview risultati
- Apply: merge risultati ETL con dati esistenti
- Rispetta is_overridden per le celle modificate manualmente
- Salvataggio storico versioni query
"""

import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import HTTPException

from engine.models import Tool, ToolColumn, ToolRow, ToolCell
from engine.service import (
    get_tool, get_columns, serialize_row,
    _get_column_map, _find_tag, _now,
    SYSTEM_COLUMNS
)
from core.audit import write_log


# ============================================================
# PREVIEW — esegue query e restituisce risultati grezzi
# ============================================================

def etl_preview(
    db: Session,
    tool_id: int,
    project_id: int,
    sql: str
) -> dict:
    """
    Esegue la query ETL e restituisce un'anteprima
    dei risultati senza modificare nulla nel database.

    Restituisce:
    {
        "columns": [...],
        "rows": [...],
        "row_count": N,
        "warnings": [...]
    }
    """
    get_tool(db, tool_id, project_id)

    sql = sql.strip()
    if not sql:
        raise HTTPException(status_code=422, detail="Query ETL vuota")

    _check_sql_safety(sql)

    try:
        result = db.execute(text(sql))
        columns = list(result.keys())
        rows    = [dict(zip(columns, row)) for row in result.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore SQL: {str(e)}")

    warnings = []

    # Verifica presenza colonna TAG
    if "tag" not in [c.lower() for c in columns]:
        warnings.append(
            "La query non include una colonna 'tag'. "
            "Il TAG è necessario per il merge con i dati esistenti."
        )

    return {
        "columns":   columns,
        "rows":      rows,
        "row_count": len(rows),
        "warnings":  warnings
    }


# ============================================================
# APPLY — merge ETL con dati esistenti
# ============================================================

def etl_apply(
    db: Session,
    tool_id: int,
    project_id: int,
    sql: str
) -> dict:
    """
    Esegue la query ETL e fa il merge con i dati esistenti.

    Logica:
    1. Crea automaticamente le colonne mancanti dai risultati SQL
       (escluse le colonne di sistema: tag, rev, log)
    2. Merge per ogni riga risultato basato su TAG:
       - Se TAG esiste già: aggiorna celle non-overridden
       - Se TAG non esiste: crea nuova riga

    Restituisce:
    {
        "columns_created": N,  ← colonne create automaticamente
        "created": N,
        "updated": N,
        "skipped_cells": N,
        "errors": [...]
    }
    """
    tool    = get_tool(db, tool_id, project_id)

    # Esegui query
    preview     = etl_preview(db, tool_id, project_id, sql)
    etl_rows    = preview["rows"]
    etl_columns = [c.lower() for c in preview["columns"]]

    # ----------------------------------------------------------
    # STEP 1 — Crea automaticamente le colonne mancanti
    # ----------------------------------------------------------
    columns_created = 0
    for idx, col_slug in enumerate(etl_columns):
        if col_slug in SYSTEM_COLUMNS:
            continue

        # Verifica se la colonna esiste già
        existing_col = db.query(ToolColumn).filter(
            ToolColumn.tool_id == tool_id,
            ToolColumn.slug    == col_slug
        ).first()

        if not existing_col:
            # Calcola posizione: dopo le colonne esistenti non-system
            last_non_system = db.query(ToolColumn).filter(
                ToolColumn.tool_id   == tool_id,
                ToolColumn.is_system == False
            ).order_by(ToolColumn.position.desc()).first()

            position = (last_non_system.position + 1) if last_non_system else 2

            new_col = ToolColumn(
                tool_id   = tool_id,
                name      = col_slug.upper().replace("_", " "),
                slug      = col_slug,
                col_type  = "text",
                width     = 120,
                position  = position,
                is_system = False
            )
            db.add(new_col)
            columns_created += 1

    if columns_created > 0:
        db.flush()  # Rende le nuove colonne disponibili per il merge

    # Ricarica la mappa colonne aggiornata
    col_map = _get_column_map(db, tool_id)

    created       = 0
    updated       = 0
    skipped_cells = 0
    errors        = []

    # Posizione per nuove righe
    last_row = db.query(ToolRow).filter(
        ToolRow.tool_id == tool_id
    ).order_by(ToolRow.position.desc()).first()
    next_pos = (last_row.position + 1) if last_row else 0

    for etl_row in etl_rows:
        # Normalizza chiavi in lowercase
        normalized = {k.lower(): v for k, v in etl_row.items()}
        tag_value  = str(normalized.get("tag", "")).strip()

        if not tag_value:
            errors.append("Riga senza TAG — saltata")
            continue

        try:
            # Cerca riga esistente per TAG
            existing_cell = _find_tag(db, tool_id, tag_value)

            if existing_cell:
                # UPDATE — riga esistente
                row = db.query(ToolRow).filter(
                    ToolRow.id == existing_cell.row_id
                ).first()

                if not row:
                    continue

                for col_slug, value in normalized.items():
                    if col_slug in SYSTEM_COLUMNS:
                        continue

                    col = col_map.get(col_slug)
                    if not col:
                        continue

                    str_value = str(value).strip() if value is not None else None

                    # Cerca cella esistente
                    cell = db.query(ToolCell).filter(
                        ToolCell.row_id == row.id,
                        ToolCell.column_id == col.id
                    ).first()

                    if cell and cell.is_overridden:
                        # Cella modificata manualmente — non toccare
                        skipped_cells += 1
                        continue

                    if cell:
                        cell.value = str_value
                    else:
                        cell = ToolCell(
                            row_id=row.id,
                            column_id=col.id,
                            value=str_value,
                            is_overridden=False
                        )
                        db.add(cell)

                updated += 1

            else:
                # INSERT — nuova riga
                row = ToolRow(
                    tool_id=tool_id,
                    project_id=project_id,
                    position=next_pos,
                    rev=tool.current_rev,
                    is_deleted=False
                )
                db.add(row)
                db.flush()

                for col_slug, value in normalized.items():
                    if col_slug in SYSTEM_COLUMNS:
                        continue
                    col = col_map.get(col_slug)
                    if not col:
                        continue
                    str_value = str(value).strip() if value is not None else None
                    cell = ToolCell(
                        row_id=row.id,
                        column_id=col.id,
                        value=str_value,
                        is_overridden=False
                    )
                    db.add(cell)

                # Crea anche la cella TAG
                tag_col = col_map.get("tag")
                if tag_col:
                    tag_cell = ToolCell(
                        row_id=row.id,
                        column_id=tag_col.id,
                        value=tag_value,
                        is_overridden=False
                    )
                    db.add(tag_cell)

                write_log(
                    db=db,
                    project_id=project_id,
                    tool=tool.slug,
                    action="ETL_INSERT",
                    row_id=row.id,
                    new_value=tag_value
                )

                next_pos += 1
                created  += 1

            db.flush()

        except Exception as e:
            errors.append(f"TAG '{tag_value}': {str(e)}")
            db.rollback()
            continue

    db.commit()

    return {
        "columns_created": columns_created,
        "created":         created,
        "updated":         updated,
        "skipped_cells":   skipped_cells,
        "errors":          errors
    }


# ============================================================
# STORICO VERSIONI QUERY
# ============================================================

def save_etl_version(
    db: Session,
    tool_id: int,
    project_id: int,
    sql: str,
    label: str = None
) -> dict:
    """
    Salva una versione della query ETL nello storico.
    Le versioni sono salvate nel campo query_config del tool
    come lista JSON.

    Mantiene le ultime 20 versioni.
    """
    tool = get_tool(db, tool_id, project_id)

    config = {}
    if tool.query_config:
        try:
            config = json.loads(tool.query_config)
        except Exception:
            config = {}

    history = config.get("etl_history", [])

    # Aggiunge nuova versione
    history.insert(0, {
        "sql":       sql,
        "label":     label or f"Versione {len(history) + 1}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })

    # Mantiene solo le ultime 20
    history = history[:20]

    config["etl_sql"]     = sql
    config["etl_history"] = history
    tool.query_config     = json.dumps(config)

    db.commit()

    return {
        "saved":   True,
        "history": history
    }


def get_etl_config(
    db: Session,
    tool_id: int,
    project_id: int
) -> dict:
    """
    Restituisce la configurazione ETL corrente del tool:
    query attiva e storico versioni.
    """
    tool = get_tool(db, tool_id, project_id)

    config = {}
    if tool.query_config:
        try:
            config = json.loads(tool.query_config)
        except Exception:
            config = {}

    return {
        "etl_sql":     config.get("etl_sql", ""),
        "etl_history": config.get("etl_history", [])
    }


# ============================================================
# UTILITY
# ============================================================

def _check_sql_safety(sql: str):
    """Blocca operazioni DDL pericolose."""
    forbidden = ["drop ", "alter ", "truncate ", "attach ", "detach ", "pragma "]
    sql_lower = sql.lower()
    for keyword in forbidden:
        if keyword in sql_lower:
            raise HTTPException(
                status_code=403,
                detail=f"Operazione non permessa: '{keyword.strip()}'"
            )