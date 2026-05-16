# columns.js — Engine

**Description:** Manages dynamic columns: header rendering, drag reorder (all columns including system), add/rename/delete, hide/show per column with CSS injection, localStorage persistence via PanelSystem.extra.

---

## Section Index

| Section | Lines | Notes |
|---------|-------|-------|
| State | 13–16 | `_columns[]`, `_hiddenColumns` (Set of slugs), `_dragSrcId`, ctx vars |
| Getters | 24–29 | `getColumns()`, `getVisibleColumns()`, `loadColumns()`, `loadFromData()` |
| Column state — localStorage | 42–85 | `_loadColumnState`, `_applyColumnOrder`, `_applyHiddenColumnsCSS`, `hideColumn`, `showColumn` |
| renderHeader | 90–128 | All columns draggable; CSS hides hidden ones; lineage tooltip |
| _attachDragListeners | 130–199 | Drag/drop + contextmenu; API call skipped for system column source |
| openAddColumnModal / submitAddColumn | 205–250 | Add column modal with auto-slug |
| renameColumn | 255–285 | prompt + confirm for ETL cols |
| deleteColumn | 290–320 | confirm + ETL warning |
| updateLocalWidth | 325–328 | Called by ResizeManager |
| Utility | 333–345 | `_toSlug`, `_escHtml`, `_escAttr` |
| Column header context menu | 350–450 | Hide/Show hidden submenu; rename; delete; fit-all-cols → ResizeManager.fitAll() |

---

## Decisions

### D1 — System column drag: frontend order only, no API call

System columns (tag, rev, log) are draggable but the reorder API is NOT called when `moved.is_system === true`. Only frontend display order (`_columns` array and `PanelSystem.extra.columnOrder`) is updated.

### D2 — CSS hiding via injected `<style id="col-visibility-style">`

Hidden columns are hidden via `[data-column-id="N"] { display: none !important; }`. This avoids changing `data-col-idx` values and requires no changes to SelectionManager or CellKeyboard. Both `<th>` and `<td>` carry `data-column-id` so one CSS rule hides both.

### D3 — Column state stored in PanelSystem.extra (same localStorage key)

`hiddenColumns: string[]` (slugs) and `columnOrder: string[]` (slugs) are stored under the existing `im_panels_${hash}` key via `PanelSystem.getExtra/setExtra`. No separate key, no second hash computation.

### D4 — User column positions start at 2

System column TAG occupies position 1. User columns start at 2. When user columns are reordered, their `position` values are recomputed from the current `_columns` order (user-only slice).
