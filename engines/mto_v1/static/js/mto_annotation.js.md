---
name: mto_annotation.js
description: MTO annotation overlay — drop target, two-click label/arrow placement, SVG rendering of tag placements on the image viewport.
type: module
---

# engines/mto_v1/static/js/mto_annotation.js

**Description:** IIFE `MtoAnnotation` — manages the SVG overlay on the image viewport for TAG annotation. Detects annotation drags from the materials table, handles two-click placement (drop sets label, second click sets arrowhead), renders all placements as SVG label+line.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_vpCoords` | 18 | Converts `MouseEvent` to 0–1 fraction coords relative to the viewport |
| `_inViewport` | 23 | Returns true if the event is within the viewport bounding rect |
| `_svgEl` | 31 | Creates an SVG element with given attributes |
| `_labelGroup` | 37 | Builds a `<g>` with `<rect>` + `<text>` for a TAG label marker |
| `_addArrowDef` | 53 | Appends `<defs><marker id="mto-arrowhead">` to the overlay SVG |
| `_addStyle` | 61 | Injects `.mto-grab` CSS into the overlay SVG — handles are invisible by default, visible on hover |
| `_grabHandle` | 67 | Creates a small circle SVG element with `pointer-events:all` for drag repositioning |
| `_startDrag` | 75 | Wires document mousemove/mouseup to reposition a label or arrowhead; calls `_onPlace` on release |
| `_renderAll` | 101 | Clears and redraws all placements + pending label + grab handles on the overlay |
| `_startCrosshair` | 131 | Enters crosshair mode: live dashed line follows cursor; `click` finalises arrow, `Escape` cancels |
| `_initDrop` | 186 | Installs (replacing any previous) document-level `mouseup` handler that detects annotation drops |
| `init` | 204 | Public — wires viewport, creates SVG overlay, registers drop handler. Called by `mto_image.js` each time an SVG is rendered. |
| `setPlacements` | 221 | Public — loads placements from backend format `{ tag, label_x, label_y, arrow_x, arrow_y }` and redraws. Called by Step 15. |
| `onPlace` | 226 | Public — registers a callback fired after each placement is finalised or repositioned (Step 15 uses this to save to backend). |

## Decisions

- **Coordinate system**: 0–1 fractions of the viewport element's `clientWidth`/`clientHeight`. Resolves the Step 13 risk: coordinates stay valid if the image is re-uploaded at a different resolution or the viewport is resized, because they scale proportionally on render.
- **Document-level `mouseup` for drop detection**: the image is displayed inside an `<object>` element (different browsing context) — events fired inside the SVG content do not bubble to the parent document. Using `document.addEventListener('mouseup')` + bounds check avoids this isolation.
- **`click` for arrow placement**: the drop `mouseup` and the arrow `click` are distinct browser events. `click` requires both `mousedown` and `mouseup` on the same target; the drop `mouseup` originates from a materials handle `mousedown`, so it never fires a `click` on the viewport. No flag/timeout needed to distinguish the two interactions.
- **Single drop handler via `_dropHandler` ref**: `init` is called on every tab switch (once per typical open). Saving and replacing the handler prevents accumulation of stale document listeners.
- **`_crosshairActive` guard**: prevents re-entering crosshair mode if the user drops a second tag before finishing the first placement.
- **Re-drop replaces**: dropping a TAG that already has a placement removes the old one before starting the new two-click flow. Ensures one placement per TAG per typical at this stage.
- **Grab handles have `pointer-events:all`**: the overlay SVG has `pointer-events:none` overall; only the handle circles opt-in. This lets pan/zoom mouse events pass through everywhere except the handles themselves.
- **`_startDrag` stops propagation**: prevents the image viewport's pan/zoom `mousedown` listener from also firing when the user grabs a handle.
- **`_renderAll` during drag**: handle elements are destroyed and recreated on each mousemove re-render, but document-level drag listeners (captured in closure) remain active — no reference to the old DOM nodes is needed.
- **`_onPlace` called on reposition release**: same callback as initial placement, so Step 15's save logic covers both creation and repositioning without changes.
