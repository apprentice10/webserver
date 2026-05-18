---
name: mto_import.js
description: MTO import panel IIFE — slide-in drawer for importing typicals from an external project DB.
type: module
---

# engines/mto_v1/static/js/mto_import.js

**Description:** Self-contained IIFE that renders a right-side slide-in panel. The user enters a source `.db` file path, loads the list of typicals from that DB, and imports individual typicals with a single click.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_buildPanel` | 18–36 | Creates the panel DOM once (lazy); appends to `document.body`. Wires close, Load button, Enter key. |
| `_loadTypicals` | 39–54 | Fetches `GET /api/engines/mto/import/list?db_path=…` and delegates to `_renderList`. Shows inline error on non-200. |
| `_renderList` | 57–92 | Renders one `.mto-import-card` per typical. Shows SVG thumbnail via `<img>` to `/import/image`; non-SVG formats get a format badge; no image gets no thumbnail area. |
| `_doImport` | 95–122 | `POST /{tool_id}/import` with `source_db_path`, `source_typical_id`, `target_typical_name`. On success: marks button "✓ Imported", shows toast, calls `MtoShell.reloadTabs()`. |
| `open` | 125–131 | Reads `window.MTO_TOOL` / `window.MTO_DB` from template globals, builds panel if needed, adds `.open` class. |
| `close` | 133–135 | Removes `.open` class (CSS transition slides panel out). |
| DOMContentLoaded | 137–140 | Wires `#btn-import-typical` button in topbar. |

## Decisions

- **Lazy panel creation**: `_buildPanel` runs only on first `open()` — no DOM cost on pages that never open the panel.
- **SVG thumbnail via `<img>` tag**: points to `/api/engines/mto/import/image?...` which streams the BLOB from the source DB. Uses `loading="lazy"` so only visible cards fetch their images.
- **Target name = source name**: the import always uses the source typical's name as the target name. If a same-name typical already exists in the destination, the backend replaces its materials/image/placements (idempotent per the backend decision at Step 17).
- **No re-fetch after import**: after a successful import the card button is permanently marked "✓ Imported" without re-fetching the list — re-fetching would reset all buttons, causing confusion if the user imports multiple typicals in sequence.
- **`MtoShell.reloadTabs()` on success**: the tab bar re-fetches and re-renders without a full page reload, so the newly imported typical appears immediately.
