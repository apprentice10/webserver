# engine/routes_export.py

**Description:** Excel export endpoint. Extracted from `engine/routes.py` (P3-004). Uses openpyxl, streams `.xlsx` via `StreamingResponse`.

## Index

| Lines | Symbol |
|-------|--------|
| 1–14  | Imports, `router = APIRouter(prefix="/api/tools")` |
| 17–73 | `GET /{tool_id}/export/excel` — builds workbook from active rows, streams as attachment |

## Decisions

- **`openpyxl` imported lazily** inside the function body — keeps startup import time minimal; openpyxl is only needed when the endpoint is called.
- **Column width approximation**: uses `max(len(col_name) + 2, 12)` — simple heuristic, not pixel-accurate but avoids external font metrics.
