# history/

Subsystem for server-side audit log display and cell rollback.

Extracted from `grid.js` as part of Phase 4 frontend decomposition.

---

## Ownership

This subsystem owns:
- Fetching audit entries from the server
- Rendering audit timelines in the History sidebar panel
- Binding and executing cell rollback
- Exporting the visible audit log to a text file

This subsystem does NOT own:
- Selection state (`_ranges`, `_filteredRows`) — owned by `grid.js`
- Sidebar panel registration — owned by `panel_system.js`
- Row DOM updates after rollback — owned by `grid.js` (via `grid:rowUpdated` event)

---

## Module Map

| File | IIFE | Responsibility |
|------|------|---------------|
| `history-api.js` | `HistoryApi` | Thin wrappers over `ApiClient.getAudit` and `ApiClient.rollbackCell` |
| `history-renderer.js` | `HistoryRenderer` | Pure stateless renderers: `renderAuditEntries`, `exportLog` |
| `history-panel.js` | `HistoryPanel` | Panel display: `showRowLog`, `showCellLog`, `showRangeLog`; owns `_logSidebarCtx` state |
| `rollback-service.js` | `RollbackService` | Rollback flow: `bindRollbackButtons`, `rollbackCell`; dispatches `grid:rowUpdated` |
| `history-actions.js` | `HistoryActions` | Public facade for grid.js context menu — resolves row from `_rows`, delegates to `HistoryPanel` |

---

## Load Order

Must load after `api.js`, `utils.js`, `panel_system.js` and before `grid.js`:

```html
history/history-api.js
history/history-renderer.js
history/history-panel.js
history/rollback-service.js
history/history-actions.js
```

Internal load order within the subsystem matters:
- `history-api.js` — no subsystem deps
- `history-renderer.js` — no subsystem deps
- `history-panel.js` — depends on `HistoryApi`, `HistoryRenderer`, `RollbackService`
- `rollback-service.js` — depends on `HistoryApi`, `HistoryPanel`
- `history-actions.js` — depends on `HistoryPanel`

---

## Public Events Dispatched

| Event | Dispatcher | Payload | Consumer |
|-------|-----------|---------|----------|
| `grid:rowUpdated` | `RollbackService` | `{ rowId: number, row: object }` | `grid.js` → calls `refreshRowDOM` |

---

## Public APIs Consumed

| API | Source | Used by |
|-----|--------|---------|
| `ApiClient.getAudit(params)` | `api.js` | `HistoryApi` |
| `ApiClient.rollbackCell(rowId, colSlug, entryId)` | `api.js` | `HistoryApi` |
| `SidebarManager.open/setTitle/setContent` | `sidebar.js` | `HistoryPanel` |
| `Utils.escHtml`, `Utils.escAttr` | `utils.js` | `HistoryRenderer` |

---

## Forbidden Dependencies

History modules must NEVER:
- Access `GridManager` internals directly
- Read `_rows`, `_ranges`, `_filteredRows`, `_editingInput` from grid closure
- Call `GridManager.render()` or `refreshRowDOM()` directly
- Import from any module loaded after `grid.js`

---

## State Passing Contract

Grid state is passed explicitly at each call boundary:

```js
// grid.js context menu → history subsystem
HistoryActions.openCellHistory(rowId, colSlug, _rows);
HistoryActions.openRowHistory(rowId, _rows);
HistoryActions.openRangeHistory(_ranges, _filteredRows, ColumnsManager.getColumns());
```

History modules receive data, they do not pull it. See D13 in `_context/DECISIONS.md`.

---

## Rollback Flow

```
user clicks ↩ button
  → RollbackService.bindRollbackButtons() (bound after each panel render)
  → RollbackService.rollbackCell(rowId, colSlug, entryId)
  → HistoryApi.rollbackCell(...)          [API call]
  → document.dispatchEvent('grid:rowUpdated', { rowId, row })   [grid refreshes DOM]
  → HistoryPanel.showCellLog(rowId, colSlug, updatedRow)        [panel refreshes]
```

See D14 in `_context/DECISIONS.md`.
