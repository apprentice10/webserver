# static/engine/js/sql_editor.js

**Description:** Power SQL Editor for the Table Engine — delegates show/hide to PanelSystem, executes arbitrary SQL (SELECT/DML), renders results, preserves draft state across panel reopen.

## Index

| Symbol | Description |
|--------|-------------|
| `_sqlDraft` | Persists textarea content across panel close/open |
| `_resultsHtml` | Persists rendered results across panel close/open |
| `_init()` | Attaches `Ctrl+Enter` shortcut (fires only when `PanelSystem.isPanelOpen('sql')`) |
| `renderInto(body)` | Injects SQL editor HTML into a panel body; restores draft and results; focus on textarea |
| `toggle()` | Delegates to `PanelSystem.togglePanel('sql')` |
| `run()` | Reads `#sql-input`, calls `ApiClient.runSql`, renders results; saves to `_resultsHtml` |
| `_renderResults(data)` | Renders SELECT table or DML rowcount message into `#sql-results` |
| `clear()` | Clears textarea and results; resets `_sqlDraft` and `_resultsHtml` |

## Decisions

- **State preserved across reopen**: `_sqlDraft` and `_resultsHtml` are module-level; `renderInto` restores them so the user doesn't lose their query when switching panels.
- **No `#sql-editor-panel` in DOM**: the panel body is created on demand by `renderInto` via `PanelSystem.onActivate`. The old inline `#sql-editor-panel` div was removed from `table.html`.
- **`#tool-note` hidden textarea**: Notes panel keeps a hidden `<textarea id="tool-note">` in the DOM as shared state for `ToolbarManager.init()` (which sets note value on load) and the Notes panel `onActivate` (which reads it). The visible note area was removed from `.tool-main`.
- **DDL blocked server-side** (`_check_sql_safety` in `etl.py`): the frontend does not filter — errors come from the backend.
