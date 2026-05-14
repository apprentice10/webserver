# static/engine/js/history/rollback-service.js

**Description:** IIFE `RollbackService` — executes cell rollback and re-binds rollback buttons rendered in the history sidebar panel.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1 | `RollbackService` IIFE declaration |
| 3–13 | `_rollbackCell(rowId, colSlug, entryId)` — private async; calls `HistoryApi.rollbackCell`, dispatches `grid:rowUpdated`, toasts success, refreshes panel |
| 15–23 | `bindRollbackButtons()` — public; attaches click handlers to all `.sidebar-log-rollback` buttons currently in the DOM |
| 25 | Public API export: `{ bindRollbackButtons }` |

## Decisions

- **DOM event for grid update (D14):** After rollback, `grid:rowUpdated` CustomEvent is dispatched on `document` instead of calling `GridManager.refreshRowDOM` directly. Grid.js listens for this event (wired in P4-H6) so RollbackService has zero reference to grid internals.
- **Pass updated row to panel:** `HistoryPanel.showCellLog` receives the `updated` row returned by the API so it can fetch history by `row.tag` without accessing `_rows` in grid.js.
- **`_rollbackCell` private:** Only `bindRollbackButtons` is public; direct call from outside is not needed.
- **Load order:** Must load after `history-panel.js` (needs `HistoryPanel`, `HistoryApi`) and before `grid.js` (grid.js may call `RollbackService.bindRollbackButtons` via forwarded ref).
