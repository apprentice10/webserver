# static/engine/js/history/history-actions.js

**Description:** Thin facade that grid.js calls for all history-related context-menu actions; resolves grid state (row lookup) before delegating to `HistoryPanel`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 3–5   | `openRowHistory(rowId, rows)` | Looks up row by id, calls `HistoryPanel.showRowLog` |
| 7–10  | `openCellHistory(rowId, colSlug, rows)` | Looks up row by id, calls `HistoryPanel.showCellLog` |
| 12–14 | `openRangeHistory(ranges, filteredRows, columns)` | Delegates directly to `HistoryPanel.showRangeLog` |

## Decisions

- **Facade over HistoryPanel (P4-D1)**: grid.js passes raw grid state here; this module resolves the row object before forwarding to `HistoryPanel`, so HistoryPanel never imports grid.js globals. See `_context/DECISIONS.md` D13.
- **Row lookup by `.id`**: rows array elements use `.id` as the primary key (same convention used throughout grid.js and service.py).
