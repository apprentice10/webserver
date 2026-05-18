# static/css/mto.css

**Description:** MTO engine stylesheet — tab bar, page area, image panel, and empty-state layout. Relies on CSS custom properties defined in `static/css/main.css` (design tokens: `--border`, `--surface-1`, `--surface-2`, `--text`, `--text-muted`, `--accent`).

## Decisions

- Tab bar uses `border-bottom: 2px solid var(--accent)` on `.active` instead of a background fill — matches the panel system visual language.
- `.mto-pages` is `flex: 1; overflow: auto` so it fills remaining vertical space; requires `.tool-container` to be a flex column (provided by `layout.css`).
- Each `.mto-page` is a flex row: `.mto-image-panel` (400px fixed) on the left, `.mto-content-panel` (flex: 1) on the right. Page padding was moved from `.mto-page` to `.mto-content-panel`.
- `.mto-img-viewport` uses `overflow: hidden` and a CSS `translate+scale` transform on `.mto-img-xform` (transform-origin: 0 0) for pan/zoom — no library.
- PDF is displayed via `<embed>` so the browser's native PDF viewer handles its own zoom/scroll. Custom pan/zoom is SVG-only.
