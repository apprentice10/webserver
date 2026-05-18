---
name: mto_image.js
description: MTO image panel IIFE — upload, render, and pan/zoom an image for one typical. Handles SVG (pan/zoom), PDF (native browser viewer), and DXF (download-only placeholder).
type: module
---

# engines/mto_v1/static/js/mto_image.js

**Description:** Self-contained IIFE for the image panel on each MTO typical page. One public function `load(toolId, typicalId, db, container)` — fetches image metadata and renders the appropriate state (empty, SVG, PDF, or DXF) into the given container element.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_param` | 4 | Returns URL-encoded `db=...` query string |
| `_imgUrl` | 5 | Returns the full image GET URL for a typical |
| `_esc` | 6 | HTML-escape helper |
| `_meta` | 8–12 | GET `…/images/{typical_id}/meta` — returns `{exists, filename, format}` without loading the BLOB |
| `_bindUpload` | 14–28 | Attaches change listener to a file input; POSTs to image upload endpoint and calls `load` on success |
| `_renderEmpty` | 30–39 | Renders the upload-button state when no image exists |
| `_initPanZoom` | 41–66 | Attaches wheel-zoom (cursor-anchored) and mousedown/move/up drag to a viewport+transform pair |
| `_renderLoaded` | 68–107 | Renders toolbar (filename, replace, remove) + media content; wires replace and delete buttons |
| `_loadPlacements` | ~109 | Fetches `GET .../placements/{typical_id}` and calls `MtoAnnotation.setPlacements()` |
| `_savePlacement` | ~120 | POSTs a placement to `POST .../placements/{typical_id}` (called by `_onPlace` callback) |
| `load` | ~130 | Public entry point; fetches meta and dispatches to `_renderEmpty` or `_renderLoaded` |

## Decisions

- **SVG only gets custom pan/zoom**: PDF is embedded via `<embed>` so the browser's native PDF viewer handles zoom/scroll. DXF is not renderable — download only.
- **Pan/zoom is cursor-anchored**: the point under the cursor stays fixed during wheel-zoom. Formula: `tx' = mx - (mx - tx) * scale' / scale`.
- **`_toolId` / `_db` are module-level**: only one panel is active at a time; safe as long as MTO does not render multiple typicals simultaneously.
- **`load` is called recursively after upload/delete**: simplest way to refresh state without a separate refresh mechanism.
- **Document-level mousemove/mouseup for drag**: avoids losing the drag if the cursor leaves the viewport div. Accumulated listeners from re-renders are harmless because they reference detached DOM nodes.
- **`MtoAnnotation.init(vp, typicalId)` called after `_initPanZoom` for SVG**: wires the annotation overlay on the same viewport element. Must be called after pan/zoom so the overlay SVG is appended last (sits on top in z-order).
- **Step 15 wiring**: after `init`, `_onPlace` callback is registered to POST each placement to the backend. `_loadPlacements` is called immediately after to redraw any saved placements on the freshly-rendered SVG.
