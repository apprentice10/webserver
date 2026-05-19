Updated: 2026-05-20 10:30

# drawing.js — Drawing Toolkit

## Description

Drawing Toolkit IIFE. Attaches annotated engineering drawings (P&IDs, layouts, datasheets)
to a tool instance. Manages image gallery, canvas rendering (image + SVG overlay),
annotation CRUD, and cross-toolkit event wiring. Frontend-only — backend APIs are
engine responsibilities (D-DRW-01).

See `_context/project/drawing-toolkit.md` for the full plan, decisions, and risks.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 19–44 | STATE | Module-level variables: ctx, config, engine identity, gallery, annotation, canvas, zoom/pan, PDF state |
| 47–65 | `init(ctx, decl)` | Store context, resolve engine identity, subscribe to grid:rowSelected, mount panel |
| 68–107 | `_mountPanel()`, `openPanel()`, `_injectCss()` | Register panel with PanelSystem; CSS injection; open as float (default) or docked |
| 109–132 | `_renderPanel(body)` | Build panel shell HTML (header + gallery-strip + canvas-area); wire upload + zoom buttons; load images |
| 133–165 | `_refreshGallery()` | Re-render `.drw-gallery-strip` from `_images` state; event delegation for click/change |
| 167–178 | `_attachGalleryEvents(body)` | Wire upload button + file input; prompt for name |
| 181–232 | Image gallery CRUD | `_loadImages`, `_uploadImage`, `_deleteImage`, `_replaceImage`, `_setActiveImage`, `getActiveImage` |
| 235–258 | `_renderCanvas()` | Branches on mime_type: image path builds img+SVG; PDF path delegates to `_renderCanvasPdf` |
| 260–272 | `_applyZoomPan(body)` | Apply CSS transform on `.drw-canvas-inner`; update zoom label |
| 274–289 | `_bindZoomPan(viewport, body)` | Wheel zoom; pointer-capture pan (pointerdown/move/up); no window listeners |
| 292–298 | `_loadPdfJs()` | Lazy-load `/static/vendor/pdfjs/pdf.min.mjs`; set workerSrc; cache on `window._drwPdfLib` |
| 300–316 | `_renderCanvasPdf(area, imgRec)` | Build PDF canvas DOM (nav-bar + canvas + SVG overlay); load pdfDoc; render page 1; wire nav buttons |
| 318–333 | `_renderPdfPage(page)` | Render one PDF page onto `.drw-pdf-canvas`; size SVG overlay; update nav label + button states |
| 335–340 | `_setActivePage(page)` | Bounds-check + update `_activePage`; re-render page |
| 343–491 | Annotation rendering | `_loadAnnotations`, `_renderAnnotations`, `_renderAnnotationSvg`, `getAnnotations` — Step 8 |
| 494–582 | Tool mode + creation | `setMode`, `_clientToNorm`, `_updateDrawPreview`, `_removeDrawPreview`, `_finishDraw`, `_createAnnotation` — Step 9 |
| 587–665 | Drag-to-move | `_onAnnotationPointerDown`, `_shiftProps`, `_moveAnnotation` — Step 10 |
| 591–600 | Cross-toolkit | `_onGridRowSelected`, `_emitAnnotationSelected` — Step 11 |
| 603–607 | `_buildUrl(path)` | Constructs backend URL with db query param |

## Decisions

**D-DRW-01 preserved — no backend logic in this file.**
All HTTP calls go to engine-owned endpoints (`/api/engines/{slug}/tools/{toolId}/images`,
`.../annotations`). The toolkit never owns DB tables or migrations.

**PDF.js loaded as pre-built ESM from `/static/vendor/pdfjs/`.**
Dynamic `import()` is used so the 300 KB + 1.3 MB bundle is not parsed until the first PDF is opened. The loaded module is cached on `window._drwPdfLib` so the import only runs once per page. `GlobalWorkerOptions.workerSrc` must point to the worker file on the same origin; a CDN URL would cause a CORS error when the worker tries to fetch its own sub-resources.

**`window.Drawing` — not `window.Image`.**
`window.Image` is a native browser constructor. Using `Image` as the IIFE name would
shadow it silently and break any code that creates `new Image()` (e.g., canvas rendering
itself in Step 6). Decision D-DRW-10.

**CSS injected dynamically via `_injectCss()`.**
`drawing.css` is served from `/static/engine/js/toolkits/drawing/drawing.css`. The toolkit
injects a `<link>` tag once on first mount rather than requiring template changes per engine.
This keeps the Drawing Toolkit self-contained and engine-agnostic.

**Panel opens as float by default (D-DRW-13).**
`_mountPanel` checks `_config.displayMode === 'docked'` before deciding between
`showPanel` (docked) and `moveToFloat` (float). Both branches only fire if
`isPanelOpen` returns false — the persisted PanelSystem layout takes precedence on reload.

**`_refreshGallery` uses event delegation.**
`gallery.onclick` and `gallery.onchange` are reassigned on each render rather than
attaching per-card listeners. Safe because the gallery is fully re-rendered on every state
change; avoids listener accumulation.

**Coordinate system: normalized 0.0–1.0.**
`x_px = x * renderedWidth`. Stored as floats in `_annotations[n].x` / `.y`. Never store
pixel coordinates — they break on resize and zoom. Decision D-DRW-06.

**Cross-toolkit: event bus only.**
`ctx.emit` / `ctx.on` exclusively. No `ctx.getToolkit('grid')` calls. Decouples Drawing
from engines that may not have a Grid Toolkit. Decision D-DRW-11.

**Style resolution order.**
`annotation.style ?? _config.styles[type]`. Per-annotation override is the fallback;
per-type preset from `toolkit_config` (or `engine.json` defaults) is the primary source.
Decision D-DRW-09.

**Drag feedback via SVG `transform`, not re-render.**
During a drag, `_onAnnotationPointerDown` applies `translate(dx,dy)` directly to the `<g>`
element as the pointer moves. `_renderAnnotations` (which replaces innerHTML) is only called
on drop. This keeps the listener closures alive on the captured shape element throughout the
gesture — re-rendering mid-drag would destroy the shape and orphan the listeners.

**Annotation shapes require `pointer-events:all` inline.**
The SVG root has CSS `pointer-events: none` so it doesn't block viewport pan/zoom. Each
annotation `<g>` explicitly sets `pointer-events:all` to receive click events in select mode.
`setMode()` overrides the SVG's inline `pointerEvents` to `none` in draw modes so the
viewport receives the full draw gesture instead.

**`_clientToNorm` uses `getBoundingClientRect()` directly.**
Since the SVG element sits inside the CSS `translate+scale` container, `getBoundingClientRect()`
returns the post-transform screen bounds. Dividing by `rect.width/height` yields normalized
coordinates without manually accounting for `_zoom` or `_panX/Y`.
