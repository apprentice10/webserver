# Shared Grid Toolkit — Integration Guide

The Shared Grid Toolkit is a set of vanilla-JS modules in `static/engine/js/grid/` that give any engine a fully functional data-grid with zero duplication. Sheet V1 is the reference consumer. MTO V1 (materials sub-table) is the second consumer, added in Group G.

---

## Core concept

The toolkit knows nothing about which engine owns the data. It talks to the backend through a single configurable string — `endpointBase` — and assumes the backend satisfies the REST contract in `GRID_API_CONTRACT.md`. The engine provides the URL; the grid does the rest.

```
Engine host page
  └─ calls GridManager.init({ endpointBase: "/api/engines/mto/42/materials/7" })
       └─ grid loads columns + rows from {endpointBase}/columns and {endpointBase}/rows
       └─ all mutations go to {endpointBase}/rows/{id}/cell, etc.
```

---

## How to wire a new engine

**Step 1 — declare the capability in `engine.json`:**
```json
{ "dashboard_uses": ["grid-api v1"] }
```

**Step 2 — implement the REST contract.** See `GRID_API_CONTRACT.md`. At minimum: Tool GET, Columns CRUD, Rows GET + POST + PATCH cell + soft-delete + restore + hard-delete + reorder + paste (Core level).

**Step 3 — load scripts in the host template.** The required load order:
```
utils.js → api.js → [grid sub-modules] → grid.js → panel_system.js → sidebar.js
```
Full sub-module list (all in `static/engine/js/grid/`):
```
columns.js, resize.js, paste.js,
rendering/grid-renderer.js, selection/selection-manager.js,
keyboard/cell-keyboard.js, context-menu/context-menu.js,
row-ops/row-ops.js, row-ops/row-drag.js,
clipboard/clipboard-manager.js, cut-paste/cut-paste.js,
paste-special/paste-special.js, fill/fill-handle.js,
cell-save/cell-save.js, panels/panel-floats.js, panels/panel-tab-bar.js,
history/history-api.js, history/history-renderer.js,
history/history-panel.js, history/rollback-service.js,
history/history-actions.js,
revision-picker/revision-picker.js, autocomplete/autocomplete.js,
find-replace/find-replace.js, sort-filter/sort-filter.js,
undo/undo-manager.js, flags.js, sidebar.js
```
Then `grid.js` last among grid modules (it orchestrates all the others).

**Step 4 — let the Grid Toolkit adapter own init (recommended):**

Declare `{ "id": "grid", "type": "grid", ... }` in `engine.json`. ToolkitHost will call `Grid.init(ctx, decl)`, which calls `PanelSystem.init()` then `GridManager.init()` in the correct order. The page template must NOT call these directly.

For sub-entity switching, call:
```js
await ToolkitHost.getToolkit('grid').setEndpointBase(newUrl);
```

This clears filters, selection, and grouping state before reloading (D-SGT-04).

**Auto-init guard (D-SGT-10):** `grid.js` checks `window.__ENGINE_CONFIG__` at load time. When present (any ToolkitHost page), `grid.js` does NOT register a DOMContentLoaded auto-start — init is delegated to the adapter. When absent (legacy/no-toolkit pages), `grid.js` auto-starts on DOMContentLoaded with an empty `endpointBase`. The guard is triggered by the presence of `window.__ENGINE_CONFIG__`, which is injected by Jinja2 before grid scripts load — verify template ordering if Sheet V1 breaks.

`GridManager.init` has an `_initialized` guard: the second call in the same page load is a no-op. This prevents double-init during the transitional period when both mto_shell.js and the adapter may call it.

**Step 5 — PanelSystem:** no longer needed when using the adapter — the adapter owns PanelSystem.init(). For the legacy explicit-call path: init PanelSystem before GridManager.

---

## Feature levels

Not all endpoints are mandatory. Match the feature level to what your engine needs:

| Level | What you implement | What the grid enables |
|-------|-------------------|-----------------------|
| **Core** | Tool GET, Columns CRUD, Rows GET/POST/PATCH/delete/restore/reorder/paste | Editable grid, column management, drag-to-reorder |
| **Extended** | + Batch ops, insert above/below, copy-insert, remove override, keep, audit, find/replace, sort-filter state, export | Full Sheet-parity experience |
| **Optional** | Undo/Redo, Cell Flags, Flag Rules | Grid disables corresponding UI when absent |

The grid detects absent endpoints by their HTTP 404/405 response and silently disables the feature. No configuration flag needed.

---

## Sub-table grids (scoped to a child entity)

When the grid is scoped to a sub-entity (e.g. materials for a specific MTO typical), encode the filter in `endpointBase` itself:

```js
endpointBase = `/api/engines/mto/${toolId}/materials/${typicalId}`;
```

The grid stays stateless — it never knows about `typicalId`. The backend route handles scoping. Switching typicals means calling `ApiClient.configure` with the new base + `GridManager.reloadData()`.

---

## DOM requirements

The host page must provide these IDs (the grid renders into them):

| ID | Purpose |
|----|---------|
| `#data-grid` | The `<table>` element the grid renders rows/cells into |
| `#row-context-menu` | Right-click menu container (added once to the page) |
| `#ghost-row` | Keyboard-append ghost row at bottom of table |

These are provided by `table.html` (Sheet V1) or must be manually included in engine-specific templates.

---

## Cross-module event bus

Modules communicate via DOM `CustomEvent` dispatched on `document`. Prefix convention = emitting subsystem:

| Event | Emitter | Meaning |
|-------|---------|---------|
| `grid:rowUpdated` | `cell-save.js`, `rollback-service.js` | A row's data changed; consumers may re-render |
| `grid:selectionChanged` | `selection-manager.js` | Range selection changed |
| `history:panelRequested` | `context-menu.js` | User opened row/cell log |

---

## What the toolkit does NOT own

- ETL compile/apply/run — Sheet V1 only (`engines/sheet_v1/backend/routes_etl.py`)
- SQL Editor — Sheet V1 only
- Revisions — platform-level (`dashboard/routes.py`)
- ETL Templates — Sheet V1 only
- Engine-specific toolbar buttons — each engine owns its own `toolbar.js`

These are deliberately excluded so the grid stays reusable. See `GRID_API_CONTRACT.md` §"Not Part of This Contract".

---

## Reference implementations

| Engine | endpointBase pattern | Feature level | Init location |
|--------|---------------------|---------------|---------------|
| Sheet V1 | `/api/engines/{toolId}` | Core + Extended + Optional | `table.html` explicit DOMContentLoaded call (no adapter — legacy path) |
| MTO V1 materials | `/api/engines/mto/{toolId}/materials/{typicalId}` | Core + Extended | Grid Toolkit adapter (`engine.json` → ToolkitHost → `Grid.init`); `mto_shell.js._loadMaterials` blocked by `_initialized` guard during transition |

---

## Capability reference

### Rendering and virtual scroll

`GridManager` renders only the visible slice of `_filteredRows` between two spacer `<tr class="vs-spacer">` rows (OVERSCAN = a few rows above and below the viewport). The full dataset stays in memory; the DOM stays small regardless of row count. After every `render()` call, `SelectionManager.updateHighlight()` re-applies the CSS selection overlay to the freshly rendered DOM nodes — so selection survives scroll.

Column and row HTML is generated by `GridRenderer` (`rendering/grid-renderer.js`); `grid.js` does not produce HTML directly.

---

### Manual cell editing

The edit lifecycle is entirely managed by `CellKeyboard` (`keyboard/cell-keyboard.js`):

1. **Enter edit mode** — double-click or any printable keypress on a focused cell calls `CellKeyboard.enterEditMode(input)`. This blurs any previous input, clears the selection range, removes `readonly` from the `<input>`, and focuses+selects the content.
2. **Navigation** — Arrow keys, Tab, and Enter call `_moveFocus(dCol, dRow)` which reads `data-row-idx` / `data-col-idx` from the current `<td>` and focuses the next cell. If the target row is outside the virtual-scroll window, `_scrollRowIntoView` calls `forceRender` first.
3. **Blur = save** — `onCellBlur` fires when the user leaves the cell (Tab, Enter, click elsewhere). If the value changed, it calls `CellSave.doSaveCell(inputEl, cell, newValue)`.
4. **`doSaveCell`** (`cell-save/cell-save.js`) — calls `PATCH {endpointBase}/rows/{rowId}/cell`, receives the updated row, and applies **surgical DOM patches** (override indicator dot, flag badges, log preview cell) without triggering a full `render()`. It also mutates the live `_rows` array in place so the in-memory state stays consistent.
5. **Ghost row** — a phantom row at the bottom of the grid lets the user type a tag to create a new row without a modal. `onGhostBlur` / `onGhostKeydown` call `createFromGhost(tag)` which hits `POST {endpointBase}/rows` then scrolls to the new row.

Edit mode is guarded globally: `CellKeyboard.isEditing()` is checked by `ClipboardManager`, `UndoManager`, and any other shortcut handler that must not steal input from an active cell.

---

### Range selection

`SelectionManager` (`selection/selection-manager.js`) owns all selection state:

| Gesture | Result |
|---------|--------|
| Click a cell | Single-cell range |
| Drag across cells | Rectangular range |
| Shift+click | Extend active range |
| Ctrl+click | Additive second range |
| Click column header | Select entire column |
| Click row gutter | Select entire row |
| Ctrl+A | Select all filtered rows × all columns |

Ranges are stored as `{start:{r,c}, end:{r,c}}` objects in `_ranges`. They are cleared on entering edit mode and on Escape. `render()` does NOT clear them — they persist across virtual-scroll repaints and the highlight is re-applied at the end of each render pass.

A `.range-readout` chip near the grid displays the selection dimensions (rows × cols) as the user drags.

---

### Clipboard operations

| Shortcut | Module | Behaviour |
|----------|--------|-----------|
| Ctrl+C | `ClipboardManager` | Copies the selection as TSV text to the system clipboard. Skips `log`/`rev` columns. Only active when NOT in cell edit mode. |
| Ctrl+V (on a cell) | `PasteManager` (`paste.js`) | **Range paste**: overwrites existing cells starting from the anchor cell. **Append paste**: if focus is on the ghost row, creates new rows via `POST /rows/paste`. Auto-detects TSV vs CSV. Single-value pastes (no tabs/newlines) are left to the browser. |
| Ctrl+X | `CutPaste` (`cut-paste/cut-paste.js`) | Marks cells with a dashed-border visual, captures the next paste event, writes values to the destination, then clears the source cells. |
| Ctrl+Shift+V | `PasteSpecial` (`paste-special/paste-special.js`) | Opens a smart paste dialog with column mapper, header-row detection, and a preview table before committing. |

---

### Fill handle

A 7 px square appears at the bottom-right corner of the active selection. Drag it down to fill rows, right to fill columns:

- **Numeric series**: if the source cells form a consistent arithmetic sequence, the step is continued. Single numeric cell → step defaults to 1 (Excel behaviour).
- **Text values**: repeated cyclically (e.g. a two-cell source `["A","B"]` fills A, B, A, B…).
- All fill values are sent in a single `POST /rows/batch-update` call (atomic, one undo entry).

---

### Row operations

All row mutations are range-aware: the operation applies to every qualifying row in the current selection; the right-clicked row is the fallback when nothing is selected. All use batch API endpoints (single round-trip, atomic transaction).

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Soft delete | `POST /rows/batch-op` (`operation: "soft_delete"`) | Reversible. Row stays in the dataset with `is_deleted=1`. |
| Restore | `POST /rows/batch-op` (`operation: "restore"`) | Re-shows deleted rows. |
| Hard delete | `POST /rows/batch-op` (`operation: "hard_delete"`) | Permanent. Removed from `_rows` after server confirms with `deleted_ids`. |
| Keep (ETL guard) | `POST /rows/batch-op` (`operation: "keep"`) | Prevents ETL from eliminating the row. |
| Remove override | `POST /rows/batch-remove-override` | Clears a manual cell override so ETL can write to it again. |
| Insert above / below | `POST /rows/{rowId}/insert` | Inserts a blank row at the specified position. |
| Copy-insert | `POST /rows/{rowId}/copy-insert` | Duplicates the row and inserts below. |
| Drag-to-reorder | `POST /rows/{rowId}/reorder` | Gutter handle drag; drop indicator shows insertion point. |

Soft-deleted rows are hidden by default. `GridManager.toggleDeleted()` shows/hides them via a CSS class on `#data-grid` (no `render()` needed — the rows are always in `_filteredRows` when visible mode is on).

---

### Undo / Redo

`UndoManager` (`undo/undo-manager.js`) wires Ctrl+Z / Ctrl+Y to `POST {endpointBase}/undo` and `POST {endpointBase}/redo`. After each undo/redo the full row list is reloaded (simpler than patching individual rows; acceptable since this is a low-frequency deliberate action).

The toolbar undo/redo buttons are kept in sync via the `undo:updated` custom event, which is dispatched by `CellSave`, `RowOps`, and `grid.js` after every mutation. The guard `CellKeyboard.isEditing()` prevents Ctrl+Z from being intercepted while a cell is in edit mode (browser-native input undo must remain intact).

---

### Sort and filter

`SortFilterManager` (`sort-filter/sort-filter.js`) operates entirely client-side on the in-memory `_filteredRows` array:

- **Multi-level sort**: click a column header to cycle asc → desc → none. Multiple sort levels are appended in click order, each with a rank badge on the header.
- **Per-column filter**: click the filter indicator on a header to open a dropdown with search-term inputs (wildcard `*`/`?`, OR across terms) and a checkbox list of distinct values.
- **Composition order in `_applyFilters()`**: search filter → deleted-row filter → `SortFilterManager.applyToRows()` (column filters then sort).
- State is persisted to the backend via `PATCH {endpointBase}/sort-filter-state` with a 500 ms debounce and reloaded on `init()`.

---

### Find and Replace

`FindReplace` (`find-replace/find-replace.js`) opens on Ctrl+H. Searches across all cells in `_filteredRows`, highlights all matches via `SelectionManager.setRanges()`, and sends a single `POST {endpointBase}/find_replace` with an explicit `scope` array when replacing. Autocomplete for column values is backed by `GET {endpointBase}/column_values/{colSlug}`.

---

### Flags

**Flag management** (`flags.js`) — project-scoped flags (name + color) are managed from a sidebar panel. Flags can be toggled on cells or entire rows via the context menu (fly-out submenu). Toggle semantics: if ALL selected cells already have the flag → remove; if ANY cell is missing it → add to all missing. Flag visibility per flag ID can be toggled with the eye icon; hidden flags are excluded from `GridRenderer.flagBadgesHtml`.

**Conditional flag rules** — rules (col + operator + value → flag) are tool-scoped, stored on the backend, and evaluated server-side in `GET /rows`. After adding or deleting a rule, `GridManager.reloadData()` is called so the server-evaluated flags appear immediately.

---

### Audit history and rollback

`HistoryPanel` (`history/history-panel.js`) opens via the context menu or keyboard shortcut and fetches from `GET {endpointBase}/audit`. Three views:

- **Row log** — all changes for a row, grouped by column.
- **Cell log** — single-column history for the focused cell.
- **Range log** — multi-cell history for the current selection.

Every audit entry shows an old/new value pair with timestamp and source (`user` or `etl`). A **Rollback** button on each entry calls `POST {endpointBase}/rows/{rowId}/rollback`, then dispatches `grid:rowUpdated` which causes `GridManager.refreshRowDOM` to patch that row in the DOM without a full reload.

---

### Column management

`ColumnsManager` (`columns.js`) handles column CRUD (add, rename, type-change, delete, reorder) via the column settings sidebar. `ResizeManager` (`resize.js`) handles drag-to-resize and auto-fit via double-click on the resize handle. Column width is persisted to `PATCH {endpointBase}/columns/{colId}/width`.

Column visibility (LOG / REV columns) is toggled via CSS classes on `#data-grid` — no `render()` call needed.

---

### Column and row header selection

Clicking a column header selects the entire visible column (all `_filteredRows` × that column index). Clicking a row-number gutter cell selects the entire row (all columns). Ctrl+A selects everything. These all set `_ranges` in `SelectionManager` and trigger `updateHighlight()`.

---

### Panel system integration

The grid sidebars (history, flags, sort-filter, find-replace) are registered panels in `PanelSystem`. They can be docked in the right rail, dragged to floating windows, and reordered via tab drag. `SidebarManager` (`sidebar.js`) is a thin adapter over `PanelSystem` that exposes `open(id)`, `close(id)`, and `toggle(id)`.

---

### Revision picker

`RevisionPicker` (`revision-picker/revision-picker.js`) renders a dropdown that lets the user switch the active grid revision. Switching reloads the grid data scoped to the selected revision. This is a platform-level feature (not per-engine) — the grid toolkit includes the UI component; the host engine must wire it to the revision endpoints.
