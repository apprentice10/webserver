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
- Fix: drag-and-drop reorder colonne non aveva effetto visivo — `_columns.map` iterava in ordine originale e assegnava posizioni nell'ordine sbagliato; fix con `userCols.forEach` che muta posizioni in-place sui riferimenti condivisi, poi `_columns.sort`
- Row numbers: colonna indice stile Excel (fissa a sinistra, sfondo/testo come header, non editabile, non partecipa al keyboard nav); numero 1-based basato sull'index di `_filteredRows`; cella vuota nella ghost row
- Context menu "Rimuovi modifica manuale": `DELETE /{tid}/rows/{rid}/override?col=X` ripristina `etl_value` nella cella e cancella riga da `_overrides`; voce visibile solo su click destro su cella con triangolo
- Triangolo `is_overridden` + tooltip ETL: `_overrides` aggiunge colonna `etl_value TEXT`; migrazione automatica in `_migrate_project_db`; `INSERT OR IGNORE` preserva il valore originale ETL al primo override; `overridden_cols` è ora `dict[col_slug → etl_value]`; frontend mostra `title="Valore ETL: ..."` sulla `<td>` sovrascritta
- Export Excel: route `GET /api/tools/{tid}/export/excel?project_id=N` — openpyxl, header blu bold, freeze row 1, larghezza auto, esclude colonna LOG; pulsante "Export Excel" in toolbar chiama `window.location.href` per download diretto
- **Refactor architetturale — plugin system + single project DB** (2026-04-26): eliminato SQLAlchemy completamente; `registry.db` sostituito da `data/projects.db` (sqlite3 raw, `engine/project_index.py`); metadati progetto (`_project`) e template ETL (`_templates`) ora dentro ogni project DB; `engine/catalog.py` ora scansiona `tools/*/tool.json` dinamicamente; `tools/instrument_list/tool.json` creato come manifest plugin; eliminati `database.py`, `core/models.py`, `core/audit.py`, `engine/models.py`
