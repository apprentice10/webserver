---
# engine/routes.py

**Descrizione:** Tutti gli endpoint `/api/tools/` — thin layer di routing che valida input, delega a `engine/service.py` o `engine/etl.py`, e serializza la risposta. Nessuna logica business qui.

## Indice (~520 righe)

| Righe | Sezione |
|-------|---------|
| 1–160 | Schema Pydantic: `ToolCreate`, `ToolResponse`, `ColumnCreate`, `CellUpdate`, `TemplateCreate`, `FlagCreate`, `FlagUpdate`, `CellFlagEntry`, `CellFlagToggleRequest` |
| 222–360 | FLAGS endpoints: `GET /flags`, `POST /flags`, `PATCH /flags/{id}`, `DELETE /flags/{id}`, `POST /{tool_id}/cell-flags/toggle` |
| 360–420 | TOOL endpoints: `GET /project/{id}`, `POST /project/{id}`, `GET /{tool_id}`, `PATCH /{tool_id}/settings` |
| 420–500 | Column endpoints (add, update, delete, reorder, resize) |
| 500–620 | Row endpoints (get, create, update cell, delete, restore, paste, export Excel) |
| 620–760 | ETL endpoints |

## Decisioni

- **Nessun import da `database.py` o `sqlalchemy`** post-refactor. Template e tool CRUD usano `conn: sqlite3.Connection = Depends(get_project_conn)`.
- **Template endpoints usano `get_project_conn`** (non `registry_db`): il `project_id` viene letto dai query params da `get_project_conn` internamente.
- **Route statiche prima di route parametriche** (vedi DECISIONS pitfall): `PUT /{tool_id}/columns/reorder` deve stare PRIMA di `PATCH /{tool_id}/columns/{column_id}`.
- **File a rischio splitting** (vedi RISKS.md R02): gli schema Pydantic (L1–143) possono essere estratti in `engine/schemas.py` quando si aggiunge il prossimo schema.
