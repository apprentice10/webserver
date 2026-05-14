# engine/schemas.py

**Description:** All Pydantic request/response models for the engine API. Extracted from `engine/routes.py` (P3-001) to keep route handlers free of schema noise.

## Index

| Lines | Symbol |
|-------|--------|
| 1–14  | Imports (`BaseModel`, `Optional`, `Any`, `datetime`) |
| 17–23 | `ToolCreate` |
| 26–33 | `ToolSettingsUpdate` — `current_rev` alias preserved for backward compat |
| 36–45 | `ToolResponse` |
| 48–54 | `TemplateCreate` |
| 57–67 | `TemplateResponse` |
| 70–76 | `ColumnCreate` |
| 79–85 | `ColumnUpdate` |
| 88–89 | `ColumnWidthUpdate` |
| 92–93 | `ColumnReorder` |
| 96–105 | `ColumnResponse` |
| 108–109 | `RowCreate` |
| 112–114 | `CellUpdate` |
| 117–118 | `PasteData` |
| 121–122 | `SqlQuery` |
| 125–127 | `EtlModelBody` |
| 130–131 | `EtlSqlImportBody` |
| 134–136 | `FlagCreate` |
| 139–141 | `FlagUpdate` |
| 144–146 | `CellFlagEntry` |
| 149–151 | `CellFlagToggleRequest` |

## Decisions

- **Extracted from `routes.py` (P3-001)**: schemas were inline in routes.py (lines 29–165). Moved here to reduce routes.py toward the ≤400 LOC target.
- **No business logic here**: pure data shape definitions only — validation constraints belong in service.py.
