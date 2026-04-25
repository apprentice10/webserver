# DONE.md
_Feature log — completato e verificato in produzione._

---

- Project management (create/open/delete, sessionStorage)
- Universal Table Engine: inline cell edit, keyboard nav (Tab/Enter/Arrows)
- Ghost row at grid bottom for fast row insertion
- Paste from Excel/CSV (range paste + append paste)
- Soft delete (strikethrough, restorable) + hard delete (trash only)
- Per-row LOG column with full change history (rev, timestamp, old→new)
- Column resize + reorder by drag (persisted to DB)
- Settings panel: tool name, icon picker, revision
- ETL Editor (`/tool/{pid}/{tid}/etl`): SQL → Preview → Apply
- ETL: auto-creates columns, merges by TAG, respects `is_overridden` cells
- ETL version history, template save/load (scoped by type_slug + project_id)
- Power SQL Editor (arbitrary SELECT/DML, no DDL)
- Right-click context menu (delete, restore, hard-delete, log)
- Toggle LOG column visibility (CSS class, no re-render)
- ETL staleness tracking: `is_stale` flag, orange badge in sidebar
- ETL dependency graph: `etl_deps` extracted from SQL at save time
- Topological ETL auto-run (`etl_run_saved` with `_visited` cycle guard)
- Circular dependency detection (HTTP 400 on cycle)
- Tool creation with ETL SQL from file + template scoping by tool type
- Schema browser in ETL editor
- Toolbar: stale badge, run ETL button, settings access
- Horizontal scrollbar for wide tables (`grid-scroll-container` + `width: max-content`)
- Toggle REV column visibility (CSS `.rev-hidden` class, same pattern as LOG toggle)
- Toolbar toggle buttons unified: icona + etichetta fissa, `.active` CSS segnala stato; pulsante eliminati aggiunge icona 🗑
- Double-click su `.resize-handle` → auto-fit larghezza colonna al contenuto più largo (header + celle visibili), salva nel backend
- Single click = selezione cella (select mode, readonly + leggero outline), double click / Enter / char = edit mode; Escape annulla; blur salva e torna select mode
