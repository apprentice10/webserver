---
# engine/routes.py

**Descrizione:** Tutti gli endpoint `/api/tools/` — thin layer di routing che valida input, delega a `engine/service.py` o `engine/etl.py`, e serializza la risposta. Nessuna logica business qui.

## Indice (~520 righe)

| Righe | Sezione |
|-------|---------|
| 1–143 | Schema Pydantic: `ToolCreate`, `ToolResponse`, `ColumnCreate`, `CellUpdate`, `TemplateCreate`, ecc. |
| 144–175 | Tool list/get/create/update/delete endpoints |
| 176–207 | Template endpoints: `GET /templates`, `POST /templates`, `DELETE /templates/{id}` |
| 208–241 | `POST /project/{project_id}` — crea tool (con o senza template) |
| 242–380 | Column endpoints (add, update, delete, reorder, resize) |
| 381–520 | Row endpoints (get, create, update cell, delete, restore, paste, export Excel) |

## Decisioni

- **Nessun import da `database.py` o `sqlalchemy`** post-refactor. Template e tool CRUD usano `conn: sqlite3.Connection = Depends(get_project_conn)`.
- **Template endpoints usano `get_project_conn`** (non `registry_db`): il `project_id` viene letto dai query params da `get_project_conn` internamente.
- **Route statiche prima di route parametriche** (vedi DECISIONS pitfall): `PUT /{tool_id}/columns/reorder` deve stare PRIMA di `PATCH /{tool_id}/columns/{column_id}`.
- **File a rischio splitting** (vedi RISKS.md R02): gli schema Pydantic (L1–143) possono essere estratti in `engine/schemas.py` quando si aggiunge il prossimo schema.
