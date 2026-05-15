# revision-picker.js

## Description
IIFE that owns the `#chip-rev-btn` in the topbar. Loads project revisions on init, keeps the chip text in sync (`Rev N`), and manages a fixed-position popover for listing, creating, and deleting revisions. Also owns the full read-only mode: switching to an old revision loads its snapshot into the grid, shows an amber banner, disables ETL, and enforces back-to-current / revert flow.

## Index
- `init()` — wires chip-rev click, document mousedown dismiss, then calls `_load()`
- `_load()` — fetches `GET /api/project/revisions`, updates `_revisions` + `_current` + `_viewingRevision`-aware chip
- `_updateChip()` — sets `#chip-rev-btn` text; shows `Rev N (viewing)` when snapshot-browsing
- `_open(anchor)` / `_close()` — popover DOM lifecycle
- `_renderInto(el)` — popover HTML; adds `data-rev` + `rev-item-clickable` on non-latest items
- `_bindEvents(el, latestNum)` — wires new/cancel/confirm/delete + rev-item click (switch vs back-to-current)
- `_doCreate` / `_doDelete` — revision CRUD
- `_switchToRevision(number)` — loads snapshot via `ApiClient.getRevisionSnapshot`, sets `_viewingRevision`, calls `GridManager.loadSnapshotData + setReadOnly`, shows banner, disables ETL, dispatches `revision:switched`
- `_backToCurrent()` — clears state, hides banner, re-enables ETL, calls `GridManager.reloadData + setReadOnly(false)`, refreshes revisions list
- `_doRevert(number)` — confirms, calls `ApiClient.revertRevision`, reloads page on success
- `_showBanner(n)` / `_hideBanner()` — amber `#readonly-banner` visibility
- `_setEtlDisabled(bool)` — toggles `#btn-run-etl` disabled + `#btn-etl-editor` pointer-events/opacity
- `getCurrent()` — latest live revision number
- `getViewingRevision()` — `null` if live; integer if viewing snapshot
- `backToCurrent()` — public wrapper for banner "Back to current" button
- `revertCurrent()` — public wrapper for banner "Revert" button

## Decisions
- `_viewingRevision` is the single source of truth for read-only state. All guards in CellSave, ContextMenu, and `_createFromGhost` check `RevisionPicker.getViewingRevision() !== null`.
- `revision:switched` DOM event resets `_logLastKey` in the table.html inline script so history panel re-fetches with the correct `?revision=` param.
- ETL is disabled directly (disable button + opacity link) rather than via ToolbarManager to keep the dependency one-directional.
- `_backToCurrent` calls `GridManager.reloadData()` (not `init()`) to avoid re-attaching global event listeners (ContextMenu, ClipboardManager, SelectionManager) a second time.
- Snapshot columns replace live columns via `ColumnsManager.loadFromData` + `renderHeader`. Column drag/resize actions still work visually but save no-op via CellSave guard (column width saves are not guarded — out of scope).
- Revert always reloads the page (`location.reload()`) to ensure clean state.
