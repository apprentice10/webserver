Updated: 2026-05-19 23:30

# drawing.css — Drawing Toolkit Styles

## Description

CSS for the Drawing Toolkit panel, image gallery, and canvas rendering layer. Injected
dynamically by `drawing.js` via a `<link>` tag — no engine template changes required.
Scoped exclusively under `.drw-*` class prefix.

## Index

| Lines | Selectors | Description |
|-------|-----------|-------------|
| 4–8   | `.drw-panel` | Flex column, full height, overflow hidden — root container |
| 11–49 | `.drw-header`, `.drw-upload-btn`, `.drw-zoom-controls` | Header bar: upload button + zoom controls row |
| 52–62 | `.drw-gallery-strip` | Compact scrollable gallery (max-height 180 px) — image picker |
| 64–68 | `.drw-empty` | Empty-state message — muted centered text |
| 70–77 | `.drw-img-card` | Image card — border, hover/active accent highlight |
| 79–83 | `.drw-img-thumb` | 120 px tall thumbnail — object-fit:contain on alt-bg |
| 85–91 | `.drw-img-name` | Single-line truncated name label |
| 93–103 | `.drw-img-actions` | Flex row — Replace (↺) and Delete (✕) icon buttons |
| 106–114 | `.drw-canvas-area` | Flex-1 viewport container — background, overflow hidden |
| 116–119 | `.drw-canvas-viewport` | Absolute inset — captures wheel + pointer events |
| 121–126 | `.drw-canvas-inner` | Transform target (`transform-origin: 0 0`) — wraps img + SVG tightly |
| 128–131 | `.drw-canvas-img` | Natural-size image, no CSS scaling (`max-width: none`) |
| 133–138 | `.drw-canvas-svg` | Absolute overlay over image — `pointer-events:none` |
| 140–147 | `.drw-canvas-placeholder` | Centered muted message when no image is active |
| 152 | `.drw-canvas-area` | Refined to `display: flex; flex-direction: column` to host the PDF nav bar as a flex child |
| 154–181 | `.drw-pdf-nav-bar`, buttons | Thin page-navigator strip (‹ page / total ›); only visible for PDFs |
| 183–188 | `.drw-pdf-canvas-wrap` | flex:1 container wrapping the canvas viewport when PDF is active; gives viewport a relative parent |

## Decisions

**Injected by toolkit, not loaded in the engine template.**
The engine template lists only engine-specific CSS. Toolkit CSS is self-managed to keep the
drawing toolkit deployable in any engine without template edits. See `drawing.js:_injectCss`.

**CSS custom properties fall back gracefully.**
All colors use `var(--token, fallback)` so the toolkit renders correctly even in engines
that don't define the full token set.
