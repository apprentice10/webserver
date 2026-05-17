# static/engine/js/context-menu/context-menu.js

**Description:** Right-click context menu — open/close, item dispatch (delete/restore/hard-delete/keep-row/override/history/flags/flag-note/clipboard), flag submenu rendering. All grid.js state is injected via `configure()`; no direct access to grid globals.

## Index

| Lines     | Description |
|-----------|-------------|
| 1–50      | State + injected dep vars (getRows, getFilteredRows, applyFilters, render, row ops, clipboard ops) |
| 52–65     | `configure({...})` — injects grid-local getters, row-mutating ops, and clipboard ops (cutSelection, copySelection, pasteFromClipboard, openPasteSpecial) |
| 67–180    | `init()` — attaches click / document click / keydown / flags-trigger mouseenter listeners |
| 82–95     | Clipboard action dispatch: `ctx-cut`, `ctx-copy`, `ctx-paste`, `ctx-paste-special` |
| 182–270   | `open(e, rowId, fromDeleted)` — positions menu, sets item visibility, resets flag cache |
| 225–230   | Clipboard item visibility: cut/copy hidden on deleted rows; all 4 hidden in revision-viewing mode |
| 278–286   | `_close()` — hides menu, clears all `_ctx*` state |
| 291–309   | `_getExistingNote(flagId, cells)`, `_showNoteEditor(flagId, cells, triggerEl)` |
| 315–365   | `_flagCheckState`, `_populateFlagsSubmenu` — flag submenu HTML |
| 367–375   | `removeFlagFromCells(flagId)` — removes flag from local cache, calls `_render()` |

## Decisions

- **configure() injection**: follows the same pattern as `CellKeyboard.configure()`. Grid state accessed via getter closures.
- **Clipboard ops injected via configure()**: `cutSelection`, `copySelection`, `pasteFromClipboard`, `openPasteSpecial` delegate to CutPaste, ClipboardManager, PasteManager, PasteSpecial respectively.
- **Context menu Paste always uses PasteManager** (fresh clipboard read), never CutPaste. Cut state is keyboard-only.
- **All 4 clipboard items always visible** (no async clipboard-state gating). Empty clipboard fails gracefully with a toast from the delegated module.
- **Cut/Copy hidden on deleted rows**: no editable data to act on.
- **All 4 clipboard items hidden in revision-viewing mode**: consistent with other mutating actions.
- **`FlagsManager` not injected**: called inside click handler only; late binding to global is safe.
- **`openContextMenu` kept in grid.js public API**: template strings reference it directly.
- **Note action does NOT close the menu**: handled before `_close()` with early return.
- **`note-open` class pins the submenu**: stays `display:block` even if mouse leaves. Removed on dismiss.
