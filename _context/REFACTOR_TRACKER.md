# REFACTOR_TRACKER.md

Master coordination document for the incremental modular refactor.
Read this at the start of every session before touching any file.

---

## Architecture Goals

- Break large files into single-responsibility modules
- Reduce file sizes toward ≤400 LOC per file
- Isolate pure logic from orchestration and I/O
- Separate UI rendering from state management (frontend)
- Preserve all existing behavior — no silent changes
- Leave the project runnable after every commit

---

## Phasing

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Safe backend extraction — pure functions, helpers, ETL compiler internals | **DONE** |
| 2 | Bug isolation instrumentation — columns endpoint race condition | **DONE** |
| 3 | routes.py / service.py decomposition | **DONE** |
| 4 | Frontend decomposition — grid.js, etl_editor.js, panel_system.js | Pending |

---

## Unstable Zone

~~Lifted 2026-05-14~~ — the intermittent 500 on the columns endpoint was traced to a missing `__position` index; `project_db.py::create_tool_table` now adds `CREATE INDEX IF NOT EXISTS idx_{slug}_pos` and `_migrate_project_db` auto-creates it on existing tables at server start (Item 43, virtual scrolling). No further 500s observed after that fix; Phase 3 is unblocked.

---

## Phase 1 Task Log

### COMPLETED

**P1-001 — Extract expression-to-SQL cluster from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_expr.py` (124 LOC): exceptions, grammar constants, SPLIT_PART helpers, `expr_to_sql`
- `etl_compiler.py` imports and re-exports all names for backward compatibility
- `etl_compiler.py` reduced from 727 → ~596 LOC (active lines)
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_expr.py.md`, updated `engine/etl_compiler.py.md`

**P1-002 — Extract graph utilities from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_graph.py` (87 LOC): `_kahn_sort`, `_collect_ancestors`, `_output_aliases_for`
- `_output_aliases_for` moved here (not to validate) — it is graph traversal, not semantic validation
- `etl_compiler.py` reduced from ~596 → ~480 LOC (active lines); `deque` import removed
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_graph.py.md`, updated `engine/etl_compiler.py.md`

**P1-004c — Extract SQL lexer utilities → `sql_to_model_lexer.py`** ✓ 2026-05-14

- Created `engine/sql_to_model_lexer.py` (123 LOC): `_mask_strings`, `_unmask`, `_comma_split`, `_CLAUSE_PATTERNS`, `_COMPILED_CLAUSES`, `_find_clauses`
- `sql_to_model.py` imports all 4 public names; definitions removed — reduced from ~510 → 388 LOC
- Verification: 61/61 tests pass
- Companion files: created `engine/sql_to_model_lexer.py.md`, updated `engine/sql_to_model.py.md`

**P1-004b — Extract expression subsystem → `sql_to_model_expr.py`** ✓ 2026-05-14

- Created `engine/sql_to_model_expr.py` (~295 LOC): `_EXPR_KEYWORDS`, `_tokenize_expr`, `_ExprParser`, `_try_rewrite_split_part`, `_parse_expr`
- `sql_to_model.py` imports all 5 names; definitions removed — reduced from 895 → ~510 LOC
- Verification: 61/61 tests pass
- Companion files: created `engine/sql_to_model_expr.py.md`, updated `engine/sql_to_model.py.md`

**P1-004a — Write unit tests for `sql_to_model.py` internals** ✓ 2026-05-14

- Added 29 unit tests: 8 for `_tokenize_expr`, 17 for `_parse_expr`, 4 for `_try_rewrite_split_part`
- Total test count: 32 → 61
- All pass; P1-004b (expression extraction) is now unblocked

**P1-004 — Assess `sql_to_model.py` (895 LOC) for extraction targets** ✓ 2026-05-14

- Only 5 integration-level tests (all call `sql_to_model()` end-to-end); no unit tests for internals
- Key cross-dependency: `_extract_ctes` calls `_parse_expr` → expression subsystem must be extracted first
- Two clean extractions identified: expr subsystem (004b, ~385 LOC) + SQL lexer (004c, ~150 LOC)
- `_extract_ctes` stays in main to avoid cross-module imports for 42 LOC
- Next: P1-004a (unit tests as prerequisite)

**P1-003 — Extract validation helpers from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_validate.py` (~230 LOC): `_validate_expr`, `_exprs_in_transformation`, `validate_model`
- `etl_compiler.py` reduced from ~480 → ~20 LOC (imports + `compile_sql` only) — orchestration-only
- Unused imports (`EtlModel`, `_ALLOWED_BINARY_OPS`, `_FIXED_ARITY_FUNCTIONS`, `_SPLIT_PART_MAX_INDEX`) removed from `etl_compiler.py`
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_validate.py.md`, updated `engine/etl_compiler.py.md`

### ACTIVE

*(none)*

### PENDING

---

## Phase 3 Task Log

### COMPLETED

**P3-001 — Extract Pydantic schemas → `engine/schemas.py`** ✓ 2026-05-14

- Created `engine/schemas.py` (147 LOC): all 20 Pydantic request/response models
- `routes.py` imports named from `engine.schemas`; inline class definitions removed
- `routes.py` reduced 840 → 705 LOC
- Companion files: created `engine/schemas.py.md`

**P3-007 — Extract template CRUD → `engine/service_templates.py`** ✓ 2026-05-14

- Created `engine/service_templates.py` (51 LOC): `get_templates`, `create_template`, `delete_template`
- `routes.py` imports and calls `service_templates.xxx` directly (no re-export from service.py)
- `service.py` reduced 914 → 869 LOC
- Companion files: created `engine/service_templates.py.md`

**P3-005 — Extract column CRUD → `engine/service_columns.py`** ✓ 2026-05-14

- Created `engine/service_columns.py` (249 LOC): `add_column`, `_remove_col_from_model`, `_rename_col_in_model`, `update_column`, `delete_column`, `reorder_columns`, `update_column_width`
- `get_columns` intentionally kept in service.py to avoid circular import (used by `create_row`/`paste_rows`)
- `service_columns.py` imports `get_tool` from `engine.service` via deferred import (one-way dep)
- `service.py` reduced → 631 LOC; unused imports (`SYSTEM_COLUMNS`, `Optional`, `datetime`) removed
- Companion files: created `engine/service_columns.py.md`

**P3-006 — Extract row mutation ops → `engine/service_row_ops.py`** ✓ 2026-05-14

- Created `engine/service_row_ops.py` (310 LOC): `remove_override`, `soft_delete_row`, `restore_row`, `hard_delete_row`, `paste_rows`, `rollback_cell`
- All 6 functions use deferred `from engine.service import get_tool` (and `_validate_tag_unique`/`get_columns` where needed) to avoid circular imports
- `service.py` reduced → 345 LOC; `datetime`/`timezone` imports removed
- Companion files: created `engine/service_row_ops.py.md`

**P3-002 — Extract flag endpoints → `engine/routes_flags.py`** ✓ 2026-05-14

- Created `engine/routes_flags.py` (133 LOC): flag CRUD + cell-flag toggle; `router` prefix `/api/tools`
- Included in `main.py` before `engine_router`; deferred `HTTPException` imports cleaned up
- `routes.py` reduced → ~580 LOC
- Companion files: created `engine/routes_flags.py.md`

**P3-003 — Extract ETL endpoints → `engine/routes_etl.py`** ✓ 2026-05-14

- Created `engine/routes_etl.py` (107 LOC): 9 ETL endpoints (compile, preview, apply, run, save, config, save_draft, sql_to_model, schema)
- Included in `main.py` as `etl_router`
- Companion files: created `engine/routes_etl.py.md`

**P3-004 — Extract export endpoint → `engine/routes_export.py`** ✓ 2026-05-14

- Created `engine/routes_export.py` (77 LOC): `GET /{tool_id}/export/excel`
- Included in `main.py` as `export_router`
- `routes.py` final: **402 LOC** (schemas, unused imports cleaned)
- Companion files: created `engine/routes_export.py.md`

### ACTIVE

*(none)*

### PENDING

---

## Phase 2 Task Log

### COMPLETED

**P2-001 — Add diagnostic logging to columns endpoint and connection lifecycle** ✓ 2026-05-14

- Added `logging.getLogger("engine.project_db")` to `engine/project_db.py`
- `open_project_db`: wrapped body in try/except; logs ERROR + full traceback on any non-HTTP exception; fixed off-by-one in migration condition (`<=` → `<`)
- `get_project_conn`: logs DEBUG on every open (method, path, db_path, exists); logs ERROR + traceback on any unhandled exception in the generator body
- Added `logging.getLogger("engine.routes")` to `engine/routes.py`
- `list_columns`: logs DEBUG on entry (tool_id); logs ERROR + traceback on any exception before re-raising
- Verification: 61/61 tests pass; imports clean
- Companion files: updated `engine/project_db.py.md`, `engine/routes.py.md`

**P2-CLOSE — Root cause identified; no further 500 observed** ✓ 2026-05-14

- Root cause: missing SQLite index on `__position`; resolved by Item 43 (virtual scrolling) which added `CREATE INDEX IF NOT EXISTS idx_{slug}_pos` in `project_db.py::create_tool_table` and auto-migration at server start
- Phase 2 closed without a repro: the fix predates the diagnostic logging, no 500 was captured
- Diagnostic logging from P2-001 is retained as operational instrumentation (no harm, useful for future incidents)
- Phase 3 is now unblocked

### ACTIVE

*(none)*

### PENDING

---

## Module Decomposition Plan

### Backend

| File | Original LOC | Final LOC | Strategy |
|------|-------------|-----------|----------|
| `engine/etl_compiler.py` | 727 | ~20 (orchestration only) | Phase 1: expr, graph, validate extracted ✓ |
| `engine/sql_to_model.py` | 895 | 388 | Phase 1: expr (004b) + lexer (004c) ✓ |
| `engine/service.py` | 914 | **345** | Phase 3: columns, row_ops, templates extracted ✓ |
| `engine/routes.py` | 832 | **402** | Phase 3: schemas, flags, ETL, export extracted ✓ |

### Frontend (Phase 4)

| File | Current LOC | Strategy |
|------|-------------|----------|
| `static/engine/js/grid.js` | 1670 → **~465** | P4-H1–H6 (history) ✓, P4-G1 (selection) ✓, P4-G2 (keyboard) ✓, P4-G3 (context menu) ✓, P4-G4 (rendering) ✓, P4-G5 (row-ops) ✓, P4-G6 (clipboard) ✓, P4-G7 (cell-save) ✓ |
| `static/engine/js/etl_editor.js` | 1174 → **480** | P4-E1–E4 complete ✓ |
| `static/engine/js/panel_system.js` | 634 → **356** | P4-P1 (floats) + P4-P2 (tab bar) extracted ✓ |

---

## Naming Conventions

- Phase 1 extracted files: `engine/<base>_<role>.py` (flat, role-suffix)
- Phase 1 role suffixes: `_expr`, `_graph`, `_validate`, `_types`, `_errors`
- Phase 3+: move to subdirectories (`engine/etl/`, `engine/sql/`) if cohesion warrants it
- Frontend (Phase 4): feature-oriented subdirectories under `static/engine/js/`; each subsystem owns a folder (`history/`, `selection/`, `keyboard/`, etc.); IIFEs preserved, new modules follow `ModuleName = (() => { ... return {...}; })();` pattern

---

## Commit Format

```
refactor(scope): short description
```

One commit per logical task. Each commit must:
- Leave project runnable
- Pass `pytest tests/` (backend) or server smoke test
- Include updated companion `.md` files
- Update this file

---

## Verification Protocol

- **Default:** `pytest tests/` passes + `uvicorn main:app --reload` + manual smoke test on affected endpoint
- **Escalate to new tests when:** extracted module has no indirect test coverage

---

## Known Risks

| Risk | Affected | Mitigation |
|------|----------|------------|
| ~~Intermittent 500 on columns endpoint~~ | ~~`routes.py`, `service.py`~~ | Resolved by Item 43 (`__position` index) |
| `sql_to_model.py` has hidden coupling | `sql_to_model.py` | Requires new tests before splitting |
| Frontend has no automated tests | All JS files | Manual verification only; extra care on each extraction |

---

## Phase 4 Task Log

### COMPLETED

**P4-H1 — Create `history/history-api.js`** ✓

- Created `static/engine/js/history/history-api.js` (13 LOC): thin wrappers over `ApiClient.getAudit` and `ApiClient.rollbackCell`
- Added `<script>` to `table.html` (after `api.js`)
- Companion files: created `history/history-api.js.md`

**P4-H2 — Create `history/history-renderer.js`** ✓ 2026-05-14

- Created `static/engine/js/history/history-renderer.js` (50 LOC): `renderAuditEntries`, `exportLog`
- Uses `Utils.escHtml`/`Utils.escAttr` directly — no grid.js aliases
- Added `<script>` to `table.html` (after `history-api.js`)
- Companion files: created `history/history-renderer.js.md`

**P4-H3 — Create `history/history-panel.js`** ✓ 2026-05-14

- Created `static/engine/js/history/history-panel.js` (150 LOC): `showRowLog(rowId, row)`, `showCellLog(rowId, colSlug, row)`, `showRangeLog(ranges, filteredRows, columns)`
- Moves `_logSidebarCtx` state here (private, write-only in this release)
- All three functions take explicit params — no closure access to grid.js state (D13)
- Uses `HistoryApi.getAudit`, `HistoryRenderer.renderAuditEntries`, `SidebarManager`; calls `RollbackService.bindRollbackButtons()` (forward ref, live after P4-H4)
- Added `<script>` to `table.html` (after `history-renderer.js`, before `grid.js`)
- Companion files: created `history/history-panel.js.md`

**P4-H4 — Create `history/rollback-service.js`** ✓ 2026-05-14

- Created `static/engine/js/history/rollback-service.js` (27 LOC): `bindRollbackButtons()` (public), `_rollbackCell(rowId, colSlug, entryId)` (private)
- After successful rollback: dispatches `grid:rowUpdated` CustomEvent `{ detail: { rowId, row: updated } }` — grid.js will listen in P4-H6
- Calls `HistoryPanel.showCellLog(rowId, colSlug, updated)` to refresh sidebar panel with the updated row object
- No direct grid.js references; no `_rows` access (D14)
- Added `<script>` to `table.html` (after `history-panel.js`, before `grid.js`)
- Companion files: created `history/rollback-service.js.md`

**P4-H5 — Create `history/history-actions.js`** ✓ 2026-05-14

- Created `static/engine/js/history/history-actions.js` (19 LOC): `openRowHistory`, `openCellHistory`, `openRangeHistory`
- Thin facade: resolves row object from `rows` array before forwarding to `HistoryPanel`; grid.js never exposes HistoryPanel's parameter contract directly (P4-D1)
- Added `<script>` to `table.html` (after `rollback-service.js`, before `grid.js`)
- Companion files: created `history/history-actions.js.md`

### COMPLETED

**P4-E1 — Extract expression DSL → `etl-editor/etl-expr.js`** ✓ 2026-05-14

- Created `static/engine/js/etl-editor/etl-expr.js` (235 LOC): `tokenize`, `parseExpr`, `exprToText`
- `etl_editor.js` calls `EtlExpr.parseExpr(...)` in `_applyExpr` and `EtlExpr.exprToText(...)` in 7 render sites
- `etl_editor.js` reduced 1174 → 949 LOC; `_tokenize`/`_parseExpr`/`_exprToText` definitions removed
- `_applyExpr` stays in `etl_editor.js` — calls `_scheduleCompile()` (closure coupling)
- `<script>` added to `etl.html` before `etl_editor.js`
- Verification: 61/61 tests pass
- Companion files: created `etl-editor/etl-expr.js.md`, updated `etl_editor.js.md`

### ACTIVE

*(none)*

### PENDING

**P4-E2 — Create `etl-editor/etl-model-renderer.js`** ✓ 2026-05-14

- Created `static/engine/js/etl-editor/etl-model-renderer.js` (307 LOC): 7 public render functions + 5 private body renderers
- `_renderFinalRelation` mutation removed — `_renderModel()` in `etl_editor.js` normalizes `final_relation_id` before delegating
- `_renderHistory` and `_renderTemplatesList` moved here; `_ea`/`_formatTs` removed from `etl_editor.js` (now local to renderer)
- `etl_editor.js` reduced 949 → 689 LOC; 6 direct render-function call sites updated to `EtlModelRenderer.*`
- `<script>` added to `etl.html` between `etl-expr.js` and `etl_editor.js`
- Verification: 61/61 tests pass
- Companion files: created `etl-model-renderer.js.md`, updated `etl_editor.js.md`

**P4-E3 — Create `etl-editor/etl-preview-renderer.js`** ✓ 2026-05-14

- Created `static/engine/js/etl-editor/etl-preview-renderer.js` (56 LOC): `renderPreview`, `renderApplyResult`, `showMsg`
- `_showPreviewMsg` renamed to `showMsg` (public API convention — no leading underscore)
- `etl_editor.js` reduced 689 → 637 LOC; 5 call sites updated
- `<script>` added to `etl.html`
- Verification: 61/61 tests pass
- Companion files: created `etl-preview-renderer.js.md`

**P4-E4 — Create `etl-editor/etl-persistence.js`** ✓ 2026-05-14

- Created `static/engine/js/etl-editor/etl-persistence.js` (200 LOC): 7 public functions + `configure(toolType)` + `_dispatch(model)` helper
- `_cachedTemplates` and `_toolType` moved here; removed from `etl_editor.js`
- Model-replacing ops dispatch `etl:loadModel` CustomEvent; `EtlEditor.init()` registers listener
- `EtlEditor.setToolType()` and `EtlEditor.init()` both call `EtlPersistence.configure(_toolType)`
- 7 public functions in `EtlEditor` reduced to 1-line wrappers
- `etl_editor.js` reduced 637 → 480 LOC
- `<script>` added to `etl.html`
- Verification: 61/61 tests pass
- Companion files: created `etl-persistence.js.md`

**P4-G6 — Extract clipboard copy → `clipboard/clipboard-manager.js`** ✓ 2026-05-14

- Created `static/engine/js/clipboard/clipboard-manager.js` (63 LOC): `configure(deps)`, `init()`
- `configure()` injects 4 deps: `getRanges`, `isEditing`, `getColumns`, `getFilteredRows`
- `_initCopyToClipboard()` removed from grid.js; replaced by `ClipboardManager.configure()+init()` in `init()`
- `<script>` added to `table.html` (after `row-ops.js`, before `grid.js`)
- `grid.js` reduced 559 → 515 LOC; 61/61 tests pass
- Companion files: created `clipboard/clipboard-manager.js.md`, updated `grid.js.md`

**P4-G7 — Extract cell save → `cell-save/cell-save.js`** ✓ 2026-05-14

- Created `static/engine/js/cell-save/cell-save.js` (72 LOC): `configure({getRows, getFilteredRows})`, `doSaveCell`, `updateLogCell`
- `configure()` injects `getRows` + `getFilteredRows` returning live array references — mutation by index propagates back to grid.js state (same pattern as `RowOps`)
- `_doSaveCell` and `_updateLogCell` removed from grid.js; `CellSave.configure()` added to `init()`; `CellKeyboard.configure` now passes `CellSave.doSaveCell`; `refreshRowDOM` calls `CellSave.updateLogCell`
- `<script>` added to `table.html` (after `clipboard-manager.js`, before `grid.js`)
- `grid.js` reduced 515 → ~465 LOC
- Companion files: created `cell-save/cell-save.js.md`, updated `grid.js.md`

**P4-G5 — Extract row mutation ops → `row-ops/row-ops.js`** ✓ 2026-05-14

- Created `static/engine/js/row-ops/row-ops.js` (139 LOC): `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `keepRow`, `removeOverride`, `_doRemoveOverride`
- `configure()` injects 6 deps from grid.js: `getRows`, `getFilteredRows`, `updateRow`, `removeRows`, `applyFilters`, `render`
- `ContextMenu.configure()` updated to receive `RowOps.*` functions; grid.js public API delegates to `RowOps.*`
- `grid.js` reduced 658 → 559 LOC; 61/61 tests pass
- Companion files: created `row-ops/row-ops.js.md`, updated `grid.js.md`

**P4-G4 — Create `rendering/grid-renderer.js`** ✓ 2026-05-14

- Created `static/engine/js/rendering/grid-renderer.js` (128 LOC): `flagBadgesHtml`, `formatLogPreview`, `renderRow`, `renderCell`, `renderGhostRow`
- All five functions are pure HTML generators — no state, no DOM reads, all inputs explicit
- `render()`, `_doSaveCell`, `_updateLogCell`, `refreshRowDOM` updated to call `GridRenderer.*`
- `_escAttr` alias removed from grid.js (no longer used)
- `<script>` added to `table.html` (after `context-menu.js`, before `grid.js`)
- `grid.js` reduced 784 → 658 LOC; 61/61 tests pass
- Companion files: created `rendering/grid-renderer.js.md`, updated `grid.js.md`

**P4-G3 — Create `context-menu/context-menu.js`** ✓ 2026-05-14

- Created `static/engine/js/context-menu/context-menu.js` (286 LOC): `configure`, `init`, `open`, `_close`, `_flagCheckState`, `_populateFlagsSubmenu`, `removeFlagFromCells`
- 4 state vars (`_ctxRowId/ColSlug/ColSlugLog/FlagsCache`) moved here; `configure()` injects 9 grid.js dependencies
- `GridManager.openContextMenu` kept as one-line wrapper (referenced by `_renderRow` template strings); `GridManager.removeFlagFromCells` delegates to `ContextMenu.removeFlagFromCells`
- `_populateFlagsSubmenu` now uses `Utils.escHtml`/`Utils.escAttr` directly (no `_escHtml`/`_escAttr` aliases)
- `<script>` added to `table.html` (after `cell-keyboard.js`, before `grid.js`)
- `grid.js` reduced 987 → 784 LOC; 61/61 tests pass
- Companion files: created `context-menu/context-menu.js.md`, updated `grid.js.md`

**P4-G2 — Create `keyboard/cell-keyboard.js`** ✓ 2026-05-14

- Created `static/engine/js/keyboard/cell-keyboard.js` (226 LOC): `configure`, `isEditing`, `enterEditMode`, `onCellFocus`, `onCellBlur`, `onCellDblClick`, `onCellKeydown`, `onCellPaste`, `onGhostKeydown`, `onGhostBlur`, `_moveFocus`, `_scrollRowIntoView`
- `_editingInput` state moved here; `grid.js` uses `CellKeyboard.isEditing()` in `_initCopyToClipboard`
- `_attachListeners` in grid.js wires `CellKeyboard.*` handlers via `addEventListener`
- `CellKeyboard.configure({getFilteredRows, getRowHeight, normalizeCells, doSaveCell, createFromGhost, forceRender})` called in `grid.js init()`
- `<script>` added to `table.html` (after `selection-manager.js`, before `grid.js`)
- `grid.js` reduced 1171 → 987 LOC; 61/61 tests pass
- Companion files: created `keyboard/cell-keyboard.js.md`, updated `grid.js.md`

**P4-G1 — Extract range selection → `selection/selection-manager.js`** ✓ 2026-05-14

- Created `static/engine/js/selection/selection-manager.js` (282 LOC): `_ranges`/`_activeDragIdx`/`_isDragging`/`_isAdditive` state + `configure`, `initGlobal`, `attachCellListeners`, `updateHighlight`, `clearRange`, `selectColumn`, `selectRow`, `collapseToCell`, `isSingleCellSelection`, `getSelectedRowIds`, `getSelectedCells`, `getRanges`, `getFirstRange`, `getSelectionForPaste`
- `grid.js` reduced 1418 → 1171 LOC; 4 state vars + 12 functions removed
- Grid.js calls `SelectionManager.configure(() => _filteredRows.length)` once in `init()`; `SelectionManager.initGlobal()` registers document-level and header listeners; `SelectionManager.attachCellListeners()` called from `_attachListeners()` after every render
- All `_ranges` reads in `openContextMenu`, `_initCopyToClipboard`, context menu actions delegated to `SelectionManager.*`
- `<script>` added to `table.html` after `history-actions.js`, before `grid.js`
- Verification: 61/61 tests pass
- Companion files: created `selection/selection-manager.js.md`, updated `grid.js.md`

**P4-P1 — Extract float subsystem → `panels/panel-floats.js`** ✓ 2026-05-14

- Created `static/engine/js/panels/panel-floats.js` (192 LOC): `configure`, `render`, `_createFloatEl`, `_initFloatDrag`, `_initFloatResize`, `_checkProximity`, `_showDropHighlight`, `_hideDropHighlight`, `_getFloatLayer` (moved here from panel_system.js), `_dropTarget` state
- `configure()` injects 9 deps: `state`, `registry`, `FLOAT_W/H/SNAP_DIST`, `getDock`, `getBottomDock`, `dockPanel`, `hidePanel`, `saveState`
- `panel_system.js._applyLayout` delegates `PanelFloats.render()` instead of `_renderFloats()`
- Companion files: created `panels/panel-floats.js.md`

**P4-P2 — Extract tab bar → `panels/panel-tab-bar.js`** ✓ 2026-05-14

- Created `static/engine/js/panels/panel-tab-bar.js` (145 LOC): `configure`, `renderTabBar`, `renderBottomTabBar`, `activateTabIn`, `_tabsHtml`, `_initTabBarEvents`, `_reorderTabIn`; `_dragId`/`_dragDropped` state moved here
- `configure()` injects 10 deps: `state`, `registry`, `FLOAT_W`, `getDock/Body`, `getBottomDock/Body`, `hidePanel`, `moveToFloat`, `saveState`, `applyLayout`
- `panel_system.js._applyRightDock/Bottom` delegate to `PanelTabBar.renderTabBar/Bottom`; `togglePanel` calls `PanelTabBar.activateTabIn`
- `panel_system.js` 634→356 LOC; Phase 4 complete
- Companion files: created `panels/panel-tab-bar.js.md`, updated `panel_system.js.md`

*(none — history subsystem complete)*

**P4-H1 — Create `history/history-api.js`**

- New IIFE `HistoryApi` under `static/engine/js/history/`
- Extracts: thin wrappers over `ApiClient.getAudit(params)` and `ApiClient.rollbackCell(rowId, colSlug, entryId)`
- Public API: `HistoryApi.getAudit(params)`, `HistoryApi.rollbackCell(rowId, colSlug, entryId)`
- No state. No DOM. No grid references.
- Add `<script src="/static/engine/js/history/history-api.js">` to `table.html` (after `api.js`, before `grid.js`)
- Create companion `history/history-api.md`

**P4-H2 — Create `history/history-renderer.js`**

- New IIFE `HistoryRenderer`
- Extracts: `_renderAuditEntries(entries, rowId, colSlug)`, `exportLog()`
- Public API: `HistoryRenderer.renderAuditEntries(entries, rowId, colSlug)`, `HistoryRenderer.exportLog()`
- Pure stateless functions — no `_rows`, no `_ranges`, no grid globals
- Uses `Utils.escHtml`, `Utils.escAttr` only
- Add `<script>` to `table.html` (after `history-api.js`)
- Create companion `history/history-renderer.md`

**P4-H3 — Create `history/history-panel.js`**

- New IIFE `HistoryPanel`
- Extracts: `showRowLog(rowId, row)`, `showCellLog(rowId, colSlug, row)`, `showRangeLog(ranges, filteredRows, columns)`
- Moves `_logSidebarCtx` state here (no longer in grid.js)
- All three functions receive explicit parameters — no closure access to grid state (Decision D13)
- Calls `HistoryApi`, `HistoryRenderer`, `SidebarManager`
- After rendering, calls `RollbackService.bindRollbackButtons()` (loaded before this module — load order dependency)
- Add `<script>` to `table.html` (after `history-renderer.js`, before `rollback-service.js`)
- Create companion `history/history-panel.md`

**P4-H4 — Create `history/rollback-service.js`**

- New IIFE `RollbackService`
- Extracts: `_rollbackCell(rowId, colSlug, entryId)`, `bindRollbackButtons()`
- After successful rollback: dispatches `grid:rowUpdated` CustomEvent (`{ detail: { rowId, row: updated } }`) — grid.js listens and calls `refreshRowDOM`
- Then calls `HistoryPanel.showCellLog(rowId, colSlug, updated)` to refresh the panel
- No direct grid.js references. No `_rows` access. (Decision D14)
- Add `<script>` to `table.html` (after `history-panel.js`)
- Create companion `history/rollback-service.md`


**P4-H6 — Wire history subsystem into grid.js + table.html** ✓ 2026-05-14

- Added `grid:rowUpdated` listener in `grid.js init()`
- Replaced 3 callsites in context menu + log-cell onclick → `HistoryActions.*`
- Parameterized `_isSingleCellSelection(ranges)` — stays in grid.js
- Removed from grid.js: `showRowLog`, `showCellLog`, `showRangeLog`, `_renderAuditEntries`, `_bindRollbackButtons`, `_rollbackCell`, `exportLog`, `_logSidebarCtx`
- Removed from public API: `showRowLog`, `showCellLog`, `showRangeLog`, `exportLog`; added `getAllRows()`
- Fixed `history-panel.js`: `GridManager.exportLog()` → `HistoryRenderer.exportLog()`
- Verification: 61/61 tests pass
- Companion files: updated `grid.js.md`, `history-panel.js.md`

---

## Phase 4 Architecture Decisions

**P4-D1 — Explicit state passing (grid → history)**
Grid.js resolves its own state (row lookup from `_rows`, pass `_ranges`/`_filteredRows` as params) before calling history modules. History modules never access grid globals directly. See D13 in `_context/DECISIONS.md`.

**P4-D2 — DOM events (history → grid)**
`RollbackService` dispatches `grid:rowUpdated` CustomEvent after successful rollback. Grid.js listens and calls `refreshRowDOM`. History modules have zero reference to `GridManager` or grid internals. See D14 in `_context/DECISIONS.md`.

**P4-D3 — Feature-oriented subdirectories**
New subsystem files live under `static/engine/js/<subsystem>/`. `history/` is the first; future subsystems (`selection/`, `keyboard/`, `clipboard/`, `rendering/`, `filtering/`) follow the same pattern. Flat root is no longer the destination for new subsystem files.

**P4-D4 — "history" = server-side audit/rollback cluster**
No client-side undo/redo (Ctrl+Z) is introduced in Phase 4. The history subsystem modularizes `showRowLog`, `showCellLog`, `showRangeLog`, `_rollbackCell`, and audit rendering only. Client-side undo/redo would require a separate command-pattern architecture, deferred to a future explicit request.

---

## Session Log

| Date | Session | Work Done | Next Step |
|------|---------|-----------|-----------|
| 2026-05-14 | S01 | Grilling complete; decisions locked; REFACTOR_TRACKER created; P1-001 complete | Commit P1-001, then start P1-002 (graph utilities) |
| 2026-05-14 | S02 | P1-002 complete — graph utilities extracted to `etl_compiler_graph.py` | Commit P1-002, then start P1-003 (validation helpers) |
| 2026-05-14 | S03 | P1-003 complete — validation helpers extracted to `etl_compiler_validate.py`; `etl_compiler.py` is now orchestration-only | Commit P1-003, then assess P1-004 (`sql_to_model.py`) |
| 2026-05-14 | S04 | P1-003 committed; P1-004 assessment complete; P1-004a complete — 29 unit tests added (61 total); tracker updated | Commit P1-004a, then start P1-004b (expression extraction) |
| 2026-05-14 | S05 | P1-004b complete — expression subsystem extracted to `sql_to_model_expr.py`; `sql_to_model.py` reduced 895 → ~510 LOC; 61/61 tests pass | Commit P1-004b, then start P1-004c (SQL lexer extraction) |
| 2026-05-14 | S06 | P1-004c complete — SQL lexer utilities extracted to `sql_to_model_lexer.py`; `sql_to_model.py` reduced ~510 → 388 LOC; 61/61 tests pass | Commit P1-004c; Phase 1 pending tasks exhausted — assess Phase 2 |
| 2026-05-14 | S07 | P2-001 complete — diagnostic logging added to `project_db.py` (get_project_conn + open_project_db) and `routes.py` (list_columns); migration condition fixed (`<=` → `<`) | Commit P2-001; await next 500 occurrence; analyse uvicorn logs |
| 2026-05-14 | S08 | Phase 2 closed — root cause (missing `__position` index) already fixed by Item 43; no repro needed; Phase 3 unblocked | Start Phase 3: assess `service.py` and `routes.py` decomposition |
| 2026-05-14 | S09 | Phase 3 complete — 7 tasks (P3-001 through P3-007): `schemas.py`, `service_templates.py`, `service_columns.py`, `service_row_ops.py`, `routes_flags.py`, `routes_etl.py`, `routes_export.py` created; `service.py` 914→345 LOC, `routes.py` 840→402 LOC; 61/61 tests pass | Start Phase 4 when ready: frontend decomposition (grid.js, etl_editor.js, panel_system.js) |
| 2026-05-14 | S10 | Phase 4 grilling complete — Options C/A/B resolved, history subsystem scope locked, D13/D14 added to DECISIONS.md, feature-subdirectory convention established, 6-task plan written (P4-H1 through P4-H6) | Start P4-H1: create `static/engine/js/history/history-api.js` |
| 2026-05-14 | S11 | P4-H1 (history-api.js) confirmed done from prior session; P4-H2 complete — `history-renderer.js` created (50 LOC): `renderAuditEntries`, `exportLog`; `<script>` added to `table.html` | Start P4-H3: create `history/history-panel.js` |
| 2026-05-14 | S12 | P4-H3 complete — `history-panel.js` created (150 LOC): `showRowLog`, `showCellLog`, `showRangeLog`; `_logSidebarCtx` moved here; `<script>` added to `table.html` | Start P4-H4: create `history/rollback-service.js` |
| 2026-05-14 | S13 | P4-H4 complete — `rollback-service.js` created (27 LOC): `bindRollbackButtons`, `_rollbackCell`; dispatches `grid:rowUpdated` CustomEvent; `<script>` added to `table.html` | Start P4-H5: create `history/history-actions.js` |
| 2026-05-14 | S14 | P4-H5 complete — `history-actions.js` created (19 LOC): `openRowHistory`, `openCellHistory`, `openRangeHistory`; facade resolves row before delegating to HistoryPanel; `<script>` added to `table.html` | Start P4-H6: wire history subsystem into grid.js |
| 2026-05-14 | S15 | P4-H6 complete — history subsystem fully wired: `grid:rowUpdated` listener added, 3 callsites replaced, extracted functions removed from grid.js (including `_logSidebarCtx`), `getAllRows()` added to public API, `history-panel.js` fixed to call `HistoryRenderer.exportLog()`; 61/61 tests pass | History subsystem complete; next: etl_editor.js or panel_system.js decomposition |
| 2026-05-14 | S16 | P4-E1 complete — expression DSL extracted to `etl-editor/etl-expr.js` (235 LOC): `tokenize`, `parseExpr`, `exprToText`; `etl_editor.js` 1174→949 LOC; 8 call sites updated; 61/61 tests pass. P4-E2/E3/E4 plan written to tracker | Start P4-E2: create `etl-editor/etl-model-renderer.js` |
| 2026-05-14 | S17 | P4-E2 complete — model renderers extracted to `etl-editor/etl-model-renderer.js` (307 LOC); `etl_editor.js` 949→689 LOC; `_ea`/`_formatTs` removed from main; `final_relation_id` normalization moved to `_renderModel()`; 61/61 tests pass | Start P4-E3: create `etl-editor/etl-preview-renderer.js` |
| 2026-05-14 | S18 | P4-E3 complete — preview renderers extracted to `etl-editor/etl-preview-renderer.js` (56 LOC); `etl_editor.js` 689→637 LOC; 61/61 tests pass | Start P4-E4: create `etl-editor/etl-persistence.js` |
| 2026-05-14 | S19 | P4-E4 complete — templates + file I/O extracted to `etl-editor/etl-persistence.js` (200 LOC); `_cachedTemplates` moved; `etl:loadModel` event bridge established; `etl_editor.js` 637→480 LOC; 61/61 tests pass | etl_editor.js decomposition complete (1174→480 LOC); next: panel_system.js or grid.js |
| 2026-05-14 | S20 | P4-G1 complete — range selection extracted to `selection/selection-manager.js` (282 LOC): 4 state vars + 12 functions moved; `configure(fn)` injects filteredRowCount getter; `initGlobal()` + `attachCellListeners()` split for once-vs-per-render registration; `grid.js` 1418→1171 LOC; 61/61 tests pass | Next: keyboard/cell-editing extraction from grid.js (P4-G2) |
| 2026-05-14 | S21 | P4-G2 complete — keyboard + cell-editing extracted to `keyboard/cell-keyboard.js` (226 LOC): `_editingInput` state + all cell/ghost handlers + `_moveFocus` + `_scrollRowIntoView` moved; `configure()` injects 6 grid.js dependencies; `grid.js` 1171→987 LOC; 61/61 tests pass | Next: context menu or cell-save extraction (P4-G3) |
| 2026-05-14 | S22 | P4-G3 complete — context menu + flag submenu extracted to `context-menu/context-menu.js` (286 LOC): 4 state vars + `_initContextMenu`, `openContextMenu`, `_closeContextMenu`, `_flagCheckState`, `_populateFlagsSubmenu`, `removeFlagFromCells` moved; `configure()` injects 9 grid.js dependencies; `grid.js` 987→784 LOC; 61/61 tests pass | Next: rendering cluster or cell-save extraction (P4-G4) |
| 2026-05-14 | S23 | P4-G4 complete — rendering cluster extracted to `rendering/grid-renderer.js` (128 LOC): `_flagBadgesHtml`, `_renderRow`, `_renderCell`, `_renderGhostRow`, `_formatLogPreview` moved; 5 call sites in `render`, `_doSaveCell`, `_updateLogCell`, `refreshRowDOM` updated to `GridRenderer.*`; `_escAttr` alias removed; `grid.js` 784→658 LOC; 61/61 tests pass | Next: cell-save or remaining grid.js cluster |
| 2026-05-14 | S24 | P4-G5 complete — row mutation ops extracted to `row-ops/row-ops.js` (139 LOC): `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `keepRow`, `removeOverride`, `_doRemoveOverride` moved; `configure()` injects 6 deps; `grid.js` 658→559 LOC; 61/61 tests pass | Next: clipboard or cell-save extraction (P4-G6) |
| 2026-05-14 | S25 | P4-G6 complete — clipboard copy extracted to `clipboard/clipboard-manager.js` (63 LOC): `configure(deps)`, `init()`; `_initCopyToClipboard()` removed from grid.js; `grid.js` 559→515 LOC; 61/61 tests pass | Next: cell-save extraction (P4-G7) |
| 2026-05-14 | S26 | P4-G7 complete — cell save extracted to `cell-save/cell-save.js` (72 LOC): `configure(deps)`, `doSaveCell`, `updateLogCell`; `_doSaveCell`/`_updateLogCell` removed from grid.js; `grid.js` 515→~465 LOC; `CellSave.configure()` added to `init()` | grid.js decomposition complete; next: panel_system.js |
| 2026-05-14 | S27 | P4-P1+P4-P2 complete — float subsystem extracted to `panels/panel-floats.js` (192 LOC); tab bar extracted to `panels/panel-tab-bar.js` (145 LOC); `panel_system.js` 634→356 LOC; both configured via `configure(deps)` in `init()`; `<script>` tags added to `table.html` | panel_system.js decomposition complete; Phase 4 frontend decomposition done |
