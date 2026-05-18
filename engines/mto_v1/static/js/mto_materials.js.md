---
name: mto_materials.js
description: MTO materials table IIFE — renders, edits, adds, deletes, and reorders materials rows for one typical.
type: module
---

# engines/mto_v1/static/js/mto_materials.js

**Description:** Self-contained IIFE for the MTO materials table. One public function `load(toolId, typicalId, db, container)` — creates or refreshes the materials section inside a typical's page div.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `COLS` | 3–11 | Column definitions: key, label, editable flag. TAG and Total are readonly; the five user columns are editable. |
| `_apiFetch` | 22–25 | GET `/api/engines/mto/{tool_id}/materials/{typical_id}` |
| `_apiPost` | 27–32 | POST — adds a new materials row |
| `_apiPatch` | 34–39 | PATCH — updates one cell; returns updated row with recomputed total |
| `_apiDelete` | 41–46 | DELETE — hard-deletes a row |
| `_apiReorder` | 48–53 | POST `.../reorder` — sends new ordered_ids list |
| `_render` | 57–77 | Builds table HTML and binds event handlers; replaces wrap.innerHTML each call |
| `_bindEdit` | 81–88 | Delegation listener on tbody — opens edit on click of `.mto-mat-editable` |
| `_startEdit` | 90–120 | Replaces cell text with `<input>`, saves on blur/Enter, cancels on Escape |
| `_bindDelete` | 123–135 | Delegation listener for `.mto-mat-del` — confirms then deletes row from DOM and rows array |
| `_bindDrag` | 139–185 | Drag-to-reorder via `.mto-mat-handle`; threshold 4 px, drop indicator line, calls _apiReorder on drop |
| `_bindAnnotDrag` | 188–220 | Annotation drag source via `.mto-mat-annot-handle`; creates floating `.mto-mat-tag-pill` that follows cursor; sets `_activeDrag` while live |
| `load` | 223–253 | Public entry point; creates section once, re-fetches and re-renders wrap on every call |
| `getActiveDrag` | — | Returns `_activeDrag` (`{ typicalId, tagValue }` or null); consumed by `mto_image.js` in Step 13 |

## Decisions

- **Re-fetch on add**: clicking "+ Add Row" calls `_apiPost` then re-calls `load` entirely — simple, avoids stale-state bugs. Minor loading flicker is acceptable.
- **In-place DOM update for delete**: removes the `<tr>` directly without re-fetching, to avoid the loading flash on a destructive action.
- **In-place DOM update for cell save**: updates only the edited cell and the `total` cell in the same row. No full re-render needed.
- **`_toolId` / `_db` are module-level**: since only one typical is active at a time, these are safe as module state. If MTO ever renders multiple typicals simultaneously this must change.
- **Drop indicator is `position: absolute` on `document.body`**: avoids z-index stacking context issues inside the table.
- **TAG column is readonly**: TAG is auto-set by the backend (row id as string) and serves as the drag-source identifier for image annotation (Steps 12–15).
