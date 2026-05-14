# static/engine/js/history/history-renderer.js

**Description:** Pure stateless IIFE that renders audit-log HTML and exports it as a text file. No grid state, no network calls.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1 | `HistoryRenderer` IIFE declaration |
| 3–22 | `renderAuditEntries(entries, rowId, colSlug)` — builds `<ul>` HTML for a list of audit entries; includes rollback button when `rowId` and `colSlug` are provided |
| 24–44 | `exportLog()` — reads rendered sidebar DOM, strips buttons, downloads plain-text file `audit_log.txt` |
| 46 | Public API: `{ renderAuditEntries, exportLog }` |

## Decisions

- **No grid references**: uses `Utils.escHtml`/`Utils.escAttr` directly (not the `_escHtml`/`_escAttr` aliases inside grid.js). Pure rendering logic extracted per P4-D1.
- **exportLog reads DOM**: the function scrapes `#sidebar-panel` rather than holding an in-memory model of the log. This matches the original grid.js implementation and avoids introducing new state. A future refactor could pass the data model instead.
- **Rollback button rendered here**: the button's `data-*` attributes are set by this renderer; the click handler is bound by `RollbackService.bindRollbackButtons()` (P4-H4). Renderer and binder are intentionally separate modules.
