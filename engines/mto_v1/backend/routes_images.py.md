# routes_images.py

## Description
Image upload/download/delete endpoints for MTO typicals. One image per typical; uploading replaces any existing one.

## Index
- 1–10: imports and constants (`_ALLOWED` maps extension → MIME type)
- 13–16: `_ext(filename)` — extracts lowercase extension
- 18–24: `_require_typical()` — 404 guard
- 26–48: `POST /{tool_id}/images/{typical_id}` — upload; validates ext, DELETEs old row, INSERTs new BLOB
- 50–68: `GET /{tool_id}/images/{typical_id}` — streams BLOB with correct MIME and Content-Disposition
- 70–77: `DELETE /{tool_id}/images/{typical_id}` — removes image row
- 79–92: `GET /{tool_id}/images/{typical_id}/meta` — returns `{exists, filename, format}` without loading the BLOB; used by the frontend to decide what to show without fetching the full binary

## Decisions
- DXF cannot be rendered in the browser; it is stored and served for download only. `application/octet-stream` is intentional.
- One-image-per-typical enforced by DELETE-before-INSERT (no UNIQUE constraint needed — simpler and avoids schema changes).
- A separate `/meta` route avoids sending the BLOB just to check whether an image exists — important for SVG/PDF files that can be several MB.
