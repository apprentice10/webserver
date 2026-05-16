---
# engines/sheet_v1/backend/routes_export.py

**Description:** Excel export endpoint for Sheet V1. Streams an `.xlsx` file built from the tool's current rows and columns.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 18–77 | `GET /{tool_id}/export/excel` | Builds an openpyxl workbook from tool data; streams response with `Content-Disposition: attachment` |

## Decisions

- **`openpyxl` imported inside handler**: avoids import cost at startup; the dependency is optional for non-export usage.
- **`StreamingResponse` with `io.BytesIO`**: keeps the full workbook in memory rather than writing a temp file — acceptable for the row counts expected.
