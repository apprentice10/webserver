---
# engines/sheet_v1/backend/schemas.py

**Description:** Pydantic request/response models specific to Sheet V1. Shared base models remain in `dashboard/schemas.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 10–20 | `EngineCreate` | Create-engine payload: name, slug, type, icon, template, default columns, ETL SQL |
| 21–28 | `EngineSettingsUpdate` | Partial-update payload for engine settings |
| 30–42 | `EngineResponse` | Response model for engine objects |
| 44–59 | `TemplateCreate`, `TemplateResponse` | ETL template create/response models |
| 65–138 | Column models | `ColumnCreate`, `ColumnUpdate`, `ColumnWidthUpdate`, `ColumnReorder`, `ColumnResponse` |
| Column → end | Row/cell models | `RowCreate`, `CellUpdate`, `PasteData`, `SqlQuery`, flag models |

## Decisions

- **Split from `dashboard/schemas.py` in R6-4**: models used only by Sheet V1 routes moved here; truly shared models (error wrappers, etc.) stayed in the dashboard package.
- **`Config: from_attributes = True`** on response models because SQLite rows come back as `sqlite3.Row` objects, not dicts.
