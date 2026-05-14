# static/engine/js/etl-editor/etl-persistence.js

**Description:** Template CRUD and file I/O operations for the ETL editor. Owns `_cachedTemplates` and `_toolType` state. Model-replacing operations dispatch `etl:loadModel` CustomEvent; `EtlEditor.init()` listens.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 3–4 | `_toolType`, `_cachedTemplates` | Module-local state; `_toolType` set via `configure()` |
| 7–11 | `_EMPTY_JSON` | Serialized empty model — used by `loadTemplate` to skip confirm dialog when model is untouched |
| 13 | `configure(toolType)` | Called by `EtlEditor.setToolType()` and `EtlEditor.init()` to sync `_toolType` |
| 15–17 | `_dispatch(model)` | Fires `etl:loadModel` CustomEvent; `EtlEditor` listener sets `_model` and calls `_renderModel()` |
| 20–35 | `refreshTemplates()` | Fetches templates filtered by `_toolType`; stores in `_cachedTemplates`; delegates rendering to `EtlModelRenderer.renderTemplatesList` |
| 37–52 | `saveAsTemplate(model)` | Prompts name; calls `ApiClient.saveTemplate`; refreshes list |
| 54–68 | `loadTemplate(templateId, currentModelJson)` | Parses template JSON; guards old-SQL format; dispatches `etl:loadModel` |
| 70–79 | `deleteTemplate(templateId)` | Confirms; calls `ApiClient.deleteTemplate`; refreshes list |
| 82–96 | `importFromFile()` | Opens file picker; parses JSON; dispatches `etl:loadModel` |
| 98–107 | `exportToFile(model)` | Downloads model as `.json` via Blob URL |
| 109–163 | `importFromSql()` | Opens/reuses `#etl-sql-import-modal`; calls `ApiClient.etlSqlToModel`; dispatches `etl:loadModel` |

## Decisions

- **Extracted from `etl_editor.js` (P4-E4)**: templates and file I/O grouped here because they share `_cachedTemplates`/`_toolType` state and are the only consumers of it.
- **`etl:loadModel` CustomEvent (P4-D2 pattern)**: operations that replace `_model` dispatch an event rather than taking a callback. `EtlEditor.init()` registers the listener: `document.addEventListener("etl:loadModel", e => { _model = e.detail.model; _renderModel(); })`. Avoids passing mutable state refs across module boundaries.
- **`_EMPTY_JSON` for confirm guard**: `loadTemplate` skips the "Replace?" confirm when the current model is empty. Comparing against a local constant avoids calling `EtlEditor.getModel()` from within this module.
- **`configure(toolType)` called from two places**: `EtlEditor.setToolType()` (called externally, e.g. by Jinja2 before `init()`) and `EtlEditor.init()` (after async tool load). Both must call it to keep `_toolType` in sync.
