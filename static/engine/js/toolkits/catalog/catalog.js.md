---
name: toolkits/catalog/catalog.js
description: Catalog Toolkit — TAG autocomplete, tracked-column autocomplete, auto-fill on TAG match, divergence detection stub
type: reference
---

# static/engine/js/toolkits/catalog/catalog.js

Updated: 2026-05-19 10:00

**Description:** Catalog Toolkit IIFE (`window.Catalog`). Decorates the Grid Toolkit with catalog synchronization behavior. Reads the catalog snapshot from the `toolkits.catalog` state bucket (pre-seeded by `ToolkitHost` before any `init()` call). Manages datalist elements for TAG and tracked-column autocomplete. Fills tracked columns on TAG match. Marks diverged cells with `catalog-drift` class.

Steps 7 (catalog mode toggle) and 8 (save to catalog) are not yet implemented.

See full decisions in `_context/project/catalog-toolkit.md`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 22–37 | State | `_ctx`, `_id`, `_config`, `_tracked`, `_snapshot`, `_gridId` |
| 40–61 | `init(ctx, decl)` | Read config + snapshot, build datalists, wire `grid:loaded` + `focusout` + `input` listeners |
| 68–100 | `_buildTagDataList / _buildTrackedDataLists` | Create `<datalist>` in `<body>` from snapshot; idempotent (re-use by id) |
| 102–112 | `_injectListAttributes()` | Add `list=` attribute to visible grid inputs after each grid load |
| 120–128 | `_onTagInput(e)` | Detect datalist selection via `inputType=insertReplacementText`; fill immediately |
| 130–140 | `_onTagFocusOut(e)` | Blur fallback: fill if TAG matches and any tracked col differs |
| 142–150 | `_rowDiffersFromCatalog(rowId, tag)` | Guard check: compare in-memory row against snapshot |
| 153–170 | `_fillFromCatalog(tag, rowId)` | Save all tracked columns via `Grid.saveCellValue`; then `reload()` |
| 173–195 | `_applyDivergenceMarkers()` | Toggling `catalog-drift` class on `<td>`; sets `data-catalog-tooltip` |
| 198–204 | `refreshSnapshot(newSnapshot)` | Public: update snapshot + rebuild datalists + re-apply markers |

## Config fields (engine.json `config` block)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tracked_columns` | string[] | — | Column slugs receiving autocomplete, fill, divergence, and save behaviors |
| `grid_toolkit_id` | string | `"grid"` | Id of the Grid Toolkit instance to decorate |

## Decisions

- **Snapshot pre-seeded by ToolkitHost**: `_state.toolkits['catalog']` is populated before `Catalog.init()` is called. No async fetch in `init()`.
- **`saveCellValue` extension on Grid Toolkit**: `grid.js` exposes `saveCellValue(rowId, field, value)` which calls `ApiClient.updateCell`. After all saves, `reload()` is called for consistency. This causes a full grid reload — acceptable for v1.
- **Datalist selection detection**: uses `e.inputType === 'insertReplacementText'` (Chromium) as the primary immediate-fill trigger. Blur (`focusout`) is the cross-browser fallback.
- **`_injectListAttributes` on every `grid:loaded`**: virtual scroll replaces DOM nodes on render; list attributes must be re-injected after each load.
- **Divergence marker is CSS-only**: `catalog-drift` on `<td>`, `data-catalog-tooltip` for hover text. CSS for the tooltip is in Step 10 (companion CSS not yet written).
- **Steps 7 and 8 not implemented**: catalog mode toggle and "Save to catalog" will be added in subsequent steps.
