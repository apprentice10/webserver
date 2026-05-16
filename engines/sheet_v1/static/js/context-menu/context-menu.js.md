# static/engine/js/context-menu/context-menu.js

**Description:** Right-click context menu — open/close, item dispatch (delete/restore/hard-delete/keep-row/override/history/flags/flag-note), flag submenu rendering. All grid.js state is injected via `configure()`; no direct access to grid globals.

## Index

| Lines     | Description |
|-----------|-------------|
| 1–35      | State (`_ctxRowId`, `_ctxColSlug`, `_ctxColSlugLog`, `_ctxFlagsCache`) + injected dep vars |
| 37–45     | `configure({...})` — injects grid-local getters and row-mutating ops |
| 47–142    | `init()` — attaches click / document click / keydown / flags-trigger mouseenter listeners |
| 144–200   | `open(e, rowId, fromDeleted)` — positions menu, sets item visibility, resets flag cache |
| 202–210   | `_close()` — hides menu, clears all `_ctx*` state |
| 215–233   | `_getExistingNote(flagId, cells)` — returns the first non-empty note for a flag across selected cells |
| 235–276   | `_showNoteEditor(flagId, cells, triggerEl)` — injects an inline textarea+save button below the flag row |
| 278–320   | `_flagCheckState`, `_populateFlagsSubmenu` — flag submenu HTML; adds ✎ note button when flag is applied |
| 322–330   | `removeFlagFromCells(flagId)` — removes a flag from local cache, calls `_render()` |

## Decisions

- **configure() injection**: follows the same pattern as `CellKeyboard.configure()`. Grid state accessed via getter closures.
- **`FlagsManager` not injected**: called inside click handler only; late binding to global is safe.
- **`openContextMenu` kept in grid.js public API**: template strings reference it directly; renaming would break rendered HTML.
- **`removeFlagFromCells` in public API**: called by `flags.js` on flag delete; delegates to `ContextMenu.removeFlagFromCells`.
- **Gutter-only items**: hidden for deleted rows and in revision-viewing mode.
- **Note action does NOT close the menu**: `action === "note-flag"` returns early before `_close()`, keeping the submenu open for the inline editor.
- **Note pencil (✎) only shown when flag is applied**: `state !== "none"` — no note makes sense on unapplied flags.
- **Enter key saves note, Shift+Enter inserts newline** in the note textarea.
