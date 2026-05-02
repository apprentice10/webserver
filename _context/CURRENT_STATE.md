# CURRENT_STATE.md

*Last updated: 2026-05-02 (model-first ETL — backend layer complete)*

Completed feature history → `_context/DONE.md`

## In Progress

### Model-First ETL Architecture (plan: `C:\Users\cdomini\.claude\plans\clever-crunching-bumblebee.md`)

Complete rewrite of ETL from SQL-string-based to model-first IR.
SQL is always compiled from `EtlModel` — never stored as source of truth.

**Progress:**

| Step | File | Status |
|------|------|--------|
| 1 | `engine/etl_model.py` — dataclasses + serialization | ✅ Done |
| 2 | `engine/etl_compiler.py` — `compile_sql`, `validate_model`, `expr_to_sql` | ✅ Done |
| 3 | `tests/test_etl_model.py` — 9 tests (5 spec + 4 validation), all green | ✅ Done |
| 4 | `engine/etl.py` — all functions accept `model: dict`, SQL derived from compiler | ✅ Done |
| 5 | `engine/routes.py` — update request bodies + add `/etl/compile` endpoint | ⬜ Next |
| 6 | `engine/service.py` — bidirectional ETL (rename/delete via model, not SQL) | ⬜ |
| 7 | `static/engine/js/api.js` — ETL methods send `{model}` not `{sql}` | ⬜ |
| 8 | `static/engine/js/etl_editor.js` — full rewrite: model builder UI | ⬜ |

**Key architecture facts (read before continuing):**
- `EtlModel.final_relation_id` declares the output relation — compiler generates SQL for that relation only
- Every transformation produces a named relation identified by its `id`; inputs are relation ids
- Execution order = topological sort of the dependency DAG (list order is ignored)
- `filter.mode` is explicit (`"where"` / `"having"`) — never inferred
- `expr_sql` is opaque — never parsed, never validated for scope
- `query_config` now stores `{etl_model, etl_sql, etl_deps, etl_history}` — `etl_sql` is compiled output for display only
- `etl_history` entries now store `{model, sql, label, timestamp}`
- `sql_parser.py` is no longer called at runtime — kept as optional import adapter

**Step 5 details (routes.py):**
- Replace `class EtlSqlBody(BaseModel): sql: str` with `class EtlModelBody(BaseModel): model: dict`
- Replace `class EtlSaveBody` similarly
- All 4 write endpoints (`preview`, `apply`, `save`, `PATCH config`) accept model
- Add `POST /{tool_id}/etl/compile` — calls `compile_sql(model)` only, no DB, returns `{sql}`
- GET `config` response already updated in etl.py (returns `etl_model` key)

**Step 6 details (service.py bidirectional ETL):**
- `delete_column`: currently calls `remove_col_from_sql()` → replace with: load model, remove column by alias from select/aggregate transformations, recompile, persist
- `update_column` (rename): currently calls `rename_col_in_sql()` → replace with: load model, find column by alias, update alias, recompile, persist

## Next Priorities (ordered by value/effort)

### Group A — Quick UX wins (low effort, high impact)

1. ~~**Horizontal scrollbar** for wide tables (CSS/layout, low effort)~~ ✓
2. ~~**Toggle REV column visibility** (same CSS pattern as LOG toggle)~~ ✓
3. ~~**Double-click column border** to auto-fit width (resize.js)~~ ✓
4. ~~**Single click = cell selection, double click = edit mode**~~ ✓
5. ~~**Row numbers** — add index column Excel-style (fixed left column, same style as column headers, not editable)~~ ✓

### Group B — Cell visual indicators (medium effort, depends on A.4)

6. ~~**`is_overridden` triangle** — the flag already exists in DB; add visual indicator (red triangle top-left, CSS `::before`) on cells where `is_overridden = true`~~ ✓
7. ~~**Original ETL value tooltip** — on triangle hover, show the ETL value prior to manual modification (retrieved from `_audit` or dedicated field)~~ ✓
8. ~~**Action "Remove manual edit"** — in the context menu, restore original ETL value and delete from `_overrides`~~ ✓
9. ~~**Export to Excel** (openpyxl, medium effort)~~ ✓

### Group C — Range selection and clipboard (high effort, depends on A.4)

10. ~~**Base range selection** — click+drag to select a range of cells; visual highlight of selected range (`grid.js`)~~ ✓
11. ~~**Shift+click to extend range** — extend selection with Shift+click~~ ✓
12. ~~**Ctrl+click for discontinuous selection** — non-contiguous multi-selection~~ ✓
13. ~~**Click on column header = select entire column** — left-click on `<th>` selects all cells in the column~~ ✓
14. ~~**Click on row number = select entire row** — left-click on row number selects the full row~~ ✓
15. ~~**Excel-style range copy** — `Ctrl+C` on selected range copies to clipboard with row/column structure (tab-separated, clipboard API)~~ ✓
16. ~~**Right-click inside range = keep selection + range context menu** — do not lose selection on right-click~~ ✓
17. ~~**Right-click outside range = new selection + single cell context menu**~~ ✓

### Group D — Contextual sidebar (high effort, depends on B and C)

Collapsible right-side panel. Complements the existing context menu (which remains unchanged). Replaces modal windows (e.g. current LOG modal). Hosts LOG and FLAG manager.

18. ~~**Sidebar shell** — collapsible panel on the right side, toggle from toolbar; HTML/CSS structure in `table.html`~~ ✓
19. ~~**Sidebar: single cell LOG** — visualization of selected cell log (tree structure, see Group G); rollback original values (see Group G); cell editing remains direct on the cell, not from the sidebar~~ ✓
20. ~~**Sidebar: range LOG** — same structure as single cell LOG (Group G) but aggregated over the entire selected range; if LOG is opened from a cell → that cell log, if from a range → aggregated range log~~ ✓

### Group E — FLAG system (high effort, depends on B and D)

25. ~~**Flag DB schema** — table `_cell_flags(tool_slug, row_tag, col_slug, flag_id)` + table `_flags(id, name, color, is_system)` in project DB; system flag "manual_edit" pre-inserted; system flag `ETL: Eliminated` pre-inserted (see Group F.1)~~ ✓
26. ~~**Flag management sidebar** — panel in the sidebar: create/edit/delete flags with name+color; system flags: only color is editable~~ ✓
27. ~~**Multi-flag visual indicator** — cells with flags show colored triangles/badges (stacking supported)~~ ✓
28. ~~**Cumulative flag tooltip** — each flag circle has its own tooltip; manual_edit dot shows "ETL: {value}" or "ETL: (empty)"~~ ✓
29. ~~**FLAG context menu** — submenu "Flag" in the context menu~~ ✓

### Group F — Improved ETL SQL Editor (medium effort, independent)

30. ~~**SQL syntax highlighting** — integrate CodeMirror or Monaco Editor in `etl_editor.js`; maintain compatibility with existing saving~~ ✓
31. ~~**SQL auto-formatting** — automatic SQL indentation on load and on-demand~~ ✓
32. **Code folding + syntax validation** (optional, after highlighting)

### Group F.1 — ETL: orphan row management (medium effort, depends on Group E)

When a row imported via ETL from a source table is deleted from the source, the row in the destination table is not automatically deleted. It is instead marked with a system flag to leave the final decision to the operator.

33. ~~**System flag `ETL: Eliminated`** — when ETL detects that a previously imported row no longer exists in the source, it automatically applies the system flag `ETL: Eliminated` to the row in the destination table; the row remains present and visible~~ ✓
34. ~~**Orphan row visual indicator** — the row with flag `ETL: Eliminated` receives a visual indicator consistent with the flag system (triangle/badge, configurable color)~~ ✓
35. ~~**Context menu: entry "Keep row"** — entry visible only on rows with flag `ETL: Eliminated`; removes the flag and confirms that the operator wants to keep the row even if it no longer exists in the source; the existing "Delete row" entry remains unchanged~~ ✓
36. ~~**Architectural consistency** — verify that orphan row detection logic is integrated into the ETL apply cycle (`etl.py`), is compatible with `is_overridden`, and is tracked in LOG/audit for future rollback~~ ✓

### Group G — LOG as revision system (high effort, depends on D and C)

The LOG is displayed in the sidebar (see Group D). The structure is a navigable tree.

37. ~~**LOG architectural replacement** — `_audit` table extended with `change_type, col_slug, revision, changed_by`; all mutation paths (manual_edit, etl_update, etl_insert, delete, restore, bulk_paste, rollback) now write structured entries~~ ✓

38. ~~**Unchanged UI compatibility** — `showRowLog` migrated from modal to sidebar; fetches from `GET /tools/{tid}/audit`~~ ✓

39. ~~**Tree structure LOG** — `showRowLog` groups by col_slug (column → entries); `showRangeLog` groups by column → row → entries~~ ✓

40. ~~**Single cell rollback** — `POST /tools/{tid}/rows/{rid}/rollback?col=X&entry_id=N`; `↩` button in each LOG entry; confirms before restoring~~ ✓

41. ~~**Export LOG** — "Export LOG" button in sidebar generates downloadable `audit_log.txt` from current sidebar content~~ ✓

42. **Advanced LOG filtering** — future UI: filter by column, filter by change type, before/after diff

43. **Performance note** — goal: avoid heavy SQLite rows and degradation on large datasets (+10,000 rows); evaluate pagination or pruning

### Group G.1 — Refactor LOG → Audit System (high priority, prerequisite for Group G)

> **Note:** the DB already has a `_audit` table. This section describes its structured evolution.
> **Rule:** LOG visible in UI → yes. LOG as a dataset column → no. LOG as audit/versioning system → yes, mandatory.

*(Tasks in this group are now incorporated in Group G — see tasks 37–43)*

### Group H — Bidirectional ETL (very high effort, depends on F)

Study and implementation of the bidirectional Table → SQL relationship.

✅ 44. **Feasibility analysis** — done (`_context/ETL_BIDIRECTIONAL.md`)
✅ 45. **Column deletion → SQL update** — done (`service.delete_column` + `sql_parser.remove_col_from_sql`)
46. **Visual transformations → SQL** — prefix/suffix/replace/formula automatically generate equivalent SQL

### Group I — Project file management (high effort, architecture ready)

The refactor (2026-04-26) made each project DB self-contained (`_project` + `_templates` inside the file). The infrastructure for portable files is now in place.

47. **Save project as file** — copy of project `.db` to user-selected location (API `GET /projects/{id}/export`)
48. **Open project from file** — upload/path of an existing `.db`, register in `projects.db` via `add_project()` (API `POST /projects/import`)
49. **Automatic backup** — periodic or pre-destructive-operation backup

### Group J — DB ↔ Webserver compatibility (high effort, depends on I)

50. **Schema versioning** — `schema_version` field in each project DB; `_schema_version` table with current version number
51. **Compatibility check on open** — version check at `open_project_db()`, warning on mismatch
52. **Automatic migrations** — migration runner to bring old DBs to current version
53. **Safety rollback** — automatic backup pre-migration
54. **Future PostgreSQL compatibility** — abstract raw sqlite3 queries into a compatible layer

### Group K — View Sidebar & Toolbar Cleanup (medium effort, depends on D and E)

Consolidate column-visibility toggles into a collapsible sidebar panel (mirrors Flags sidebar pattern). Clean up redundant toolbar/topbar buttons.

55. **View sidebar shell** — new sidebar panel with items: "Deleted rows" (replaces `btn-show-deleted` / `GridManager.toggleDeleted()`) and "Rev column" (replaces `btn-toggle-rev` / `GridManager.toggleRev()`); each item has an eye icon to toggle visibility; removes both standalone toolbar buttons; saves state per-project/tool via localStorage (same pattern as Flags hidden-state in `static/engine/js/flags.js`)
56. **View toolbar button** — add "View" button after Flags in toolbar (`table.html`); opens View sidebar; mutually exclusive toggle with Flags button (only one sidebar active at a time)
57. **Remove "Cambia Rev" topbar button** — revision letter is already editable in the Settings modal (`ToolbarManager.openSettings()`); remove the redundant `{% block topbar_actions %}` button from `table.html`
58. **Replace "Info" button** — replace current `btn-toggle-sidebar` ("Info") with a dedicated toggle styled and behaving like the Flags/View buttons (shows active state when sidebar is open)
59. **Log sidebar — selection-reactive** — Log sidebar content updates automatically when the active cell or range changes (not only on context-menu trigger); if sidebar is open and selection changes, content refreshes; if nothing selected, show placeholder "Select a cell or range."

### Bug Fix — Timestamp display (low effort, independent)

60. **Fix timestamp double-localization** — `formatTimestamp()` in `static/engine/js/utils.js` calls `new Date(isoString).toLocaleString("it-IT")` but the server emits local-time strings without a timezone suffix (e.g. `"2026-04-30 15:00:00"`); JS `Date` constructor treats timezone-naive strings inconsistently across browsers and may apply a UTC offset, causing wrong displayed times; fix: change `now_str()` in `engine/utils.py` to emit UTC ISO strings (`datetime.utcnow().isoformat() + "Z"`) and update all `DEFAULT (datetime('now'))` SQLite columns to `datetime('now')` (already UTC in SQLite), then let `formatTimestamp()` convert to local display as it already does

---

### Tools backlog (low priority)

* **Cable List tool** (new type_slug, custom system columns)
* **I/O List tool** (new type_slug)
* **Workspace file system** (`.imanager` files — largest effort)

## Paused / Deferred

* EAV→flat migration tooling (already migrated, no active need)
* Multi-user / concurrency (single-user app for now)

---

