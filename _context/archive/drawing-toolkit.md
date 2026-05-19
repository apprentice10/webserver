Updated: 2026-05-19 17:00

# Plan: Phase 5 — Drawing Toolkit

## Goal

Implement a Drawing Toolkit that lets users attach annotated engineering drawings (P&IDs,
layout plans, datasheets) to any tool instance. Annotations are linked to grid rows by TAG,
draggable, stored in the project DB, and rendered as an SVG overlay on top of the image.
The toolkit is a pure frontend adapter (D20): image upload and annotation persistence are
engine-level backend responsibilities. The toolkit wires UI, manages interaction state, and
communicates with the Grid Toolkit exclusively via the Host event bus (D29).

---

## Steps

- [x] Step 1 — DB migration: add `_images` and `_annotations` system tables; bump SCHEMA_VERSION
- [x] Step 2 — Backend: image service + routes (`upload`, `list`, `blob`, `delete`, `replace`)
- [x] Step 3 — Backend: annotation service + routes (`list`, `create`, `update`, `delete`)
- [x] Step 4 — Frontend: Drawing Toolkit scaffold (`drawing.js` IIFE + `engine.json` declaration)
- [x] Step 5 — Frontend: panel + image gallery UI (list, upload, delete, replace, active image switch)
- [x] Step 6 — Frontend: canvas rendering layer (image display + SVG overlay + zoom/pan)
- [x] Step 7 — Frontend: pdf.js integration (render + page navigator)
- [x] Step 8 — Frontend: annotation rendering (SVG shapes from DB state, % → px transform)
- [x] Step 9 — Frontend: tool mode toolbar + annotation creation (click/drag per shape type)
- [x] Step 10 — Frontend: annotation drag-to-move (Select mode, PATCH on mouseup)
- [x] Step 11 — Frontend: cross-toolkit events + style presets (persist to `toolkit_config`)
- [x] Step 12 — Smoke test: SVG + PDF flow, TAG link, annotation → grid highlight, delete cascade
- [x] Step 13 — Write-back: companion docs, DECISIONS.md, GLOSSARY.md, update master plan

---

## Decisions

**D-DRW-01 — Toolkit stays strictly frontend (D20 preserved)**
Image upload and annotation persistence are engine responsibilities, not toolkit
responsibilities. The Drawing Toolkit calls engine-provided backend APIs only. Any feature
that requires new DB structure or new server logic belongs in the engine backend, not here.
Rejected: toolkit-owned backend module ("backend+frontend" type). Would collapse D20 into
hidden mini-services and break the layering model.

**D-DRW-02 — Image blobs stored in SQLite (D01 preserved)**
`_images.blob` is a BLOB column in the per-project SQLite DB. Portability (one `.db` = one
project) is the hard invariant. Large image support via chunked streaming on the blob
endpoint; optional in-memory cache for repeat access within a session.
Rejected: filesystem storage (breaks D01 portability), dual-source sync (fragile).

**D-DRW-03 — Phase 5 formats: SVG, PNG, JPEG, PDF only**
DXF requires server-side CAD conversion or an incomplete JS parser — deferred to a separate
grill-me session with real DXF files. Phase 5 scope is deterministic and reliable.

**D-DRW-04 — Multiple named images per tool**
`_images` schema: `(id TEXT PK, tool_id TEXT, name TEXT, mime_type TEXT, blob BLOB,
source_width INT, source_height INT, created_at TEXT)`. Each tool can hold N named images
("P&ID Sheet 1", "Equipment Layout"). User picks active image from a named list.

**D-DRW-05 — Annotation row link: TAG string, not `__id`**
`annotation.row_key` stores the TAG value (e.g. `"FT-101"`). TAG is the stable domain
identity; `__id` is unstable across ETL reload cycles. Empty-TAG rows are skipped by all
annotation-link operations. TAG rename breaks the link explicitly — consistent with Catalog
Toolkit behavior.

**D-DRW-06 — Position: normalized percentage coordinates**
`x, y` stored as 0.0–1.0 relative to image bounds. Rendering: `x_px = x * renderedWidth`.
Format-agnostic, zoom-agnostic, survives container resize. Optional `source_width /
source_height` on `_images` for recalibration if image is replaced.

**D-DRW-07 — Phase 5 shapes: Pin, Arrow, Rectangle, Text**
Annotation discriminated union: `type: "pin" | "arrow" | "rectangle" | "text"`.
- Pin: `{x, y, label, row_key?}`
- Arrow: `{x1, y1, x2, y2, row_key?}` — drag gesture sets both endpoints
- Rectangle: `{x, y, w, h, row_key?}` — drag gesture
- Text: `{x, y, text, row_key?}`
Polyline and Circle deferred to Phase 6. All shapes map to simple pointer interactions
(click or click-drag). Nothing requiring multi-point editing or path logic.

**D-DRW-08 — Interaction: explicit tool mode toolbar**
Toolbar buttons: Select, Pin, Arrow, Rectangle, Text. Active mode determines cursor and
drag behavior. Without a mode, a drag on empty canvas is ambiguous (pan vs draw).
Toolbar is also the surface for per-mode style controls.

**D-DRW-09 — Style: per-mode presets, per-annotation override as fallback**
Primary source: `toolkit_config.drawing.styles.{type}` (color, strokeWidth, dash,
arrowHead, fillColor, fillOpacity, fontSize). Renderer resolves:
`annotation.style ?? toolkit_config.styles[type]`.
No per-annotation property inspector — that's CAD tool scope, not instrument traceability.
Global style update instantly re-renders all annotations of that type.

**D-DRW-10 — Toolkit registration**
`type: "drawing"` → `window.Drawing` → `static/engine/js/toolkits/drawing/drawing.js`.
`window.Image` is a native browser constructor — naming it "image" would shadow it silently.
"drawing" is the correct domain term for P&ID drawings and layout plans.

**D-DRW-11 — Cross-toolkit: event bus only (D29)**
Drawing Toolkit emits `drawing:annotationSelected` `{ rowKey }` on annotation click.
Grid Toolkit subscribes and handles `scrollToRow + highlightRow` internally. Drawing
has no knowledge of Grid's existence. Reverse: Grid emits `grid:rowSelected` `{ rowKey }`;
Drawing subscribes to dim/highlight matching annotations.
Rejected: `ctx.getToolkit('grid').scrollToRow()` — structural dependency, breaks in engines
without a Grid Toolkit.

**D-DRW-12 — PDF: one record + page index on annotations**
`_images` is format-agnostic. PDF stored as a single blob row. Each annotation carries
`page?: number` (1-based, null for non-PDF assets). Drawing Toolkit owns all PDF pagination
logic. `activePage` is transient UI state — not persisted at engine level.

**D-DRW-13 — Panel layout: float default, dockable**
Drawing panel opens as a PanelSystem float (does not displace the grid).
User can dock it via standard PanelSystem drag-to-dock. Preferred mode persisted in
`toolkit_config.drawing.displayMode: "float" | "docked"`.
Full-tab takeover: out of scope for Phase 5 (requires engine infrastructure changes).

**D-DRW-14 — Image delete: cascade + confirmation**
`DELETE /images/{id}` cascades to all annotations (SQLite `ON DELETE CASCADE` on
`_annotations.image_id`). UI requires confirmation before executing. Irreversible by design.

**D-DRW-15 — Image replace: in-place blob swap, annotations preserved**
`PATCH /images/{id}` replaces only the blob and mime_type. Annotations survive — percentage
coordinates are stable across image revisions of the same drawing. UI warns: "image
geometry may have changed — verify annotation positions."

---

## Risks

- **SCHEMA_VERSION bump required**: `_images` and `_annotations` are new system tables.
  Must follow the schema versioning rule (feedback_schema_versioning.md): bump
  `SCHEMA_VERSION` in `project_db.py` and add a migration step. Skipping this causes silent
  DB incompatibility on existing projects.

- **pdf.js bundle**: pdf.js worker is ~300 KB. D03 forbids a build step — pdf.js must be
  loaded as a pre-built static file served from `static/vendor/`. Confirm the worker
  `GlobalWorkerOptions.workerSrc` path before Step 7.

- **SVG overlay alignment**: The SVG overlay must exactly track the rendered image bounds,
  including zoom/pan transforms. CSS `position: absolute` + `pointer-events: none` on the
  overlay with `transform-origin` matching the image element. Any mismatch causes annotation
  drift. Validate at multiple zoom levels before marking Step 8 done.

- **Zoom/pan scope**: Large P&IDs require zoom + pan to be usable. Phase 5 scopes to CSS
  `transform: scale()` on the image container — no custom pan/zoom engine. Annotation
  positions recalculate from percentage on every transform change via ResizeObserver.

- **Blob serve performance**: SQLite BLOB reads for large PDFs (>5 MB) may be slow on first
  request. The blob endpoint should stream the response in chunks rather than loading the
  full bytes into a Python string. Use `Response(content=blob_bytes, media_type=mime_type)`
  in FastAPI — it handles chunked transfer automatically.

- **Shared backend module vs per-engine duplication**: Image and annotation routes are
  reusable across engines. Implement as a shared service module in `dashboard/` (like
  `dashboard/etl.py`) and mount via each engine's `routes.py`. Avoid copy-pasting routes
  into every engine that uses the Drawing Toolkit.
