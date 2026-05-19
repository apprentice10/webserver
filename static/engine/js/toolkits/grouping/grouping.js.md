---
name: toolkits/grouping/grouping.js
description: Grouping Toolkit — reads unique values from a source column, mounts a combobox in a slot, and drives client-side column filters on target Grid Toolkit instances
type: reference
---

# static/engine/js/toolkits/grouping/grouping.js

**Description:** Grouping Toolkit IIFE (`window.Grouping`). Reads unique non-empty values from a configured source column in a source Grid Toolkit, renders a `<select>` combobox into a pre-allocated DOM slot, and injects client-side column filters into one or more target Grid Toolkit instances on combobox change.

All configuration is static in `engine.json`. No backend calls (D-GT-08).

See full decisions in `_context/project/grouping-toolkit.md`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–14  | Module header | IIFE outer shell; module-level state (`_ctx`, `_id`, `_config`, `_select`) |
| 23–70 | `init(ctx, decl)` | Parse config, mount combobox into slot, call `setGroupingOwned` on targets, subscribe to `grid:loaded`, wire change handler |
| 73–87 | `_populateCombobox(sourceId, column)` | On `grid:loaded`: reads `getAllRows()` from source toolkit, extracts distinct non-empty values, renders `(All)` + sorted options, preserves current selection |
| 91–93 | Return | `{ init }` — outer API for ToolkitHost |

## Config fields (engine.json `config` block)

| Field | Type | Description |
|-------|------|-------------|
| `source_toolkit_id` | string | Id of the Grid Toolkit instance to read unique values from |
| `source_column` | string | Column slug whose distinct non-empty values populate the combobox |
| `target_toolkit_ids` | string[] | Ids of Grid Toolkit instances to filter when combobox changes |
| `slot` | string | CSS selector for the pre-allocated DOM element that receives the combobox |

## Decisions

- **Client-side filter only**: `setGroupingFilter` / `clearGroupingFilter` on the target Grid Toolkit are pure in-memory calls via `SortFilterManager.setColumnFilter` — no grid reload, no backend call (D-GT-02).
- **`grid:loaded` subscription**: the Grouping Toolkit listens on `document` for `grid:loaded`, which `grid.js` dispatches at the end of both `init()` and `reloadData()`. This handles both initial load and endpoint switches.
- **Ownership lock**: `setGroupingOwned(source_column)` is called on each target toolkit during `init`. This prevents users from manually changing or opening the filter dropdown for the owned column (D-GT-03).
- **Selection preservation**: on each `grid:loaded`, the current combobox value is restored if the value still exists in the refreshed option list (D-GT-07).
- **`Utils` dependency**: `Utils.escHtml` and `Utils.escAttr` are used inside `_populateCombobox`. These are safe to call at runtime (called after `DOMContentLoaded`) even though `utils.js` loads after toolkit scripts in the HTML template.
- **Singleton IIFE**: supports one Grouping instance per page. Multiple instances would require a factory pattern — not implemented in Phase 2 (D-GT-09 deferred).
