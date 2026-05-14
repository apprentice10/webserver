# static/engine/js/etl-editor/etl-preview-renderer.js

**Description:** Stateless DOM renderers for the ETL preview/apply results panel. All functions write to `#etl-preview-container`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 5 | `_esc` | Local alias for `Utils.escHtml` |
| 7–32 | `renderPreview(data)` | Renders preview table (max 50 rows) with optional warnings; shows empty state if no rows |
| 34–46 | `renderApplyResult(result)` | Renders apply summary: columns created, rows created/updated/skipped, errors |
| 48–54 | `showMsg(msg, type)` | Renders a single message line; `type` ∈ `info|error|warning|success` |

## Decisions

- **Extracted from `etl_editor.js` (P4-E3)**: all three functions write to a single fixed DOM node (`#etl-preview-container`) and take explicit data params — ideal extraction candidates.
- **`showMsg` replaces `_showPreviewMsg`**: renamed to match public API naming convention (no leading underscore, shorter).
