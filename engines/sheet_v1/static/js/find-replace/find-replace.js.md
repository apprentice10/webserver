---
# engines/sheet_v1/static/js/find-replace/find-replace.js

**Description:** Find & Replace floating panel (Ctrl+H). Client-side match collection drives Find Next / Find All; the backend `find_replace` endpoint handles actual cell mutations.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 13 | `configure(opts)` | Injects `{getFilteredRows, scrollToRow}` from `GridManager.init()` |
| 18–24 | `_buildPattern` | Converts wildcard search string to JS `RegExp`; mirrors backend `_wildcard_to_regex` |
| 28–57 | `_collectMatches` | Scans `_filteredRows` × editable columns (or selection scope) client-side; returns `[{rowId, rowIdx, colSlug, colIdx}]` |
| 61–73 | `findAll` | Calls `_collectMatches`, sets all matches as `SelectionManager.setRanges`, scrolls to first |
| 75–82 | `findNext` | Calls `_collectMatches`, advances `_matchIdx`, collapses selection to current match |
| 87–92 | `_getFormValues` | Reads all panel form fields into a plain object |
| 94–110 | `replaceAll` | Posts to `/find_replace` backend; refreshes updated rows; resets match state |
| 112–133 | `replaceCurrent` | Replaces the current match via backend; advances to next match or shows done toast |
| 137–148 | `_makeDraggable` | Drag-to-move the panel by its header |
| 150–188 | `_buildPanel` | Builds the panel DOM once on first open; wires button and keyboard events |
| 190–204 | `open / close / isOpen` | Public lifecycle methods |

## Decisions

- **Client-side match collection**: Find Next / Find All never call the backend; they scan the in-memory `_filteredRows` array. This keeps navigation instant and avoids round-trip latency.
- **Match pattern mirrors backend**: `_buildPattern` uses the same wildcard-to-regex translation as the Python `_wildcard_to_regex` so visual highlights match what the backend will actually replace.
- **Replace uses the backend**: all cell mutations go through `ApiClient.findReplace` → `update_cell` so audit logging and override tracking are preserved.
- **Panel built lazily**: the DOM is created only on the first `open()` call to avoid paying the cost on page load.
- **Ctrl+H toggle**: wired in `grid.js/_initFindReplace`; closes if already open.
