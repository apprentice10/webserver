# Plan: Clipboard Undo + Context Menu + Paste Special Tabs

## Goal

Cut (Ctrl+X) + paste (Ctrl+V) operations are currently invisible to the undo stack — they call `updateCell` N times but never dispatch `undo:updated`, and each API call creates a separate undo entry. This plan fixes undo atomicity for all multi-cell paste paths (cut-paste, positional paste, paste-special), adds Cut/Copy/Paste/Paste Special to the row context menu, and restructures the paste-special modal into 3 tabs.

## Steps

### Backend

- [x] Step 1 — Add `batch_edit` undo type to `service_undo.py`
- [x] Step 2 — Add `batch_update_cells()` to `service.py`
- [x] Step 3 — Add `BatchCellUpdate` Pydantic model to `schemas.py`
- [x] Step 4 — Add route to `routes_main.py`

### Frontend

- [x] Step 5 — Add `ApiClient.batchUpdate(toolId, cells)` to `api.js`
- [x] Step 6 — Refactor `CutPaste._onPaste` to use `batchUpdate`
- [x] Step 7 — Refactor `PasteManager._onPaste` (`paste.js`) to use `batchUpdate`
- [x] Step 8 — Refactor `PasteSpecial.confirm()` to use `batchUpdate`
- [x] Step 9 — Restructure `ps-modal` HTML into 3 tabs
- [x] Step 10 — Update `PasteSpecial.js` for 3 tabs
- [x] Step 11 — Add clipboard items to `row-context-menu` HTML
- [x] Step 12 — Wire context menu actions in `context-menu.js`
- [x] Step 13 — Inject clipboard ops from `grid.js` into `ContextMenu.configure()`
- [x] Step 14 — Update companion `.md` files for all changed modules

## Decisions

- **Undo atomicity**: batch endpoint creates one `"batch_edit"` undo entry per paste operation regardless of cell count. One Ctrl+Z undoes the entire paste.
- **Context menu placement**: clipboard group inserted after the gutter separator, before Delete — matches Excel layout.
- **Context menu Paste**: always triggers `PasteManager` (fresh clipboard read), never CutPaste. Cut state is keyboard-only.
- **All four clipboard items always visible** in the context menu (no async clipboard-state gating). Fail gracefully with a toast if clipboard is empty.
- **Paste text tab**: positional paste, no column mapper, raw TSV values into cells starting at anchor.
- **Transpose tab**: positional paste with rows↔cols swapped, no column mapper.
- **`undo:updated` dispatch**: each paste path dispatches this event once after `batchUpdate` resolves.

## Risks

- `batch_update_cells` must guard against partial failure (one invalid col_slug shouldn't silently skip all others — collect errors and return them in the response, still commit successful cells, undo entry only includes cells that actually changed).
- CutPaste source-clear is a second `batchUpdate` call — if it fails, destination data was already written and undo entry already pushed. Document this accepted inconsistency (undo reverts the destination writes; source cells were not cleared — data is not lost).
- The row context menu `open()` height estimate (currently `window.innerHeight - 140`) may need to increase by ~88px (4 new items × 22px each) to avoid clipping the menu near the bottom of the viewport.
