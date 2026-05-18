# routes_export_excel.py

**Description:** MTO V1 — Excel export. Produces a multi-sheet `.xlsx` workbook: one sheet per typical, with an embedded image, a materials table, and tag label text boxes overlaid on the image.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_HAS_CAIROSVG` | 18 | Runtime flag — False if cairocffi/libcairo DLL is missing (Windows without GTK+) |
| `_IMG_W / _IMG_H` | 27-28 | Fixed pixel dimensions used when embedding PNG images |
| `_IMG_ROW_OFFSET_EMU` | 30 | EMU distance from sheet top to image origin (rows 1+2 at default 15pt) |
| `_get_*` | 44-77 | DB read helpers — one per relevant table |
| `_svg_to_png` | 81-88 | Convert SVG bytes → PNG via cairosvg; returns None on failure |
| `_write_sheet` | 93-141 | Add one openpyxl worksheet for a typical; returns (title, placements) |
| `_label_xml` | 147-175 | Generate raw XML string for one absoluteAnchor text box |
| `_map_sheets_to_drawings` | 178-207 | Parse workbook XML to map sheet name → drawing XML path inside the zip |
| `_inject_labels` | 210-235 | Zipfile surgery: open saved xlsx, inject text box XML into each drawing, rewrite |
| `_build_response` | 240-263 | Orchestrate: build workbook → save → inject → StreamingResponse |
| `export_excel_all` | 266-276 | `GET /{tool_id}/export/excel` — all typicals |
| `export_excel_one` | 279-290 | `GET /{tool_id}/export/excel/{typical_id}` — single typical |

## Decisions

- **SVG embedding**: requires `cairosvg` + native `libcairo` DLL. On Windows without GTK+/MSYS2, `_HAS_CAIROSVG` is False and SVG typicals show a note instead of an image. PDF and DXF always skip image embedding (format constraint).
- **Text box injection via zipfile surgery**: openpyxl 3.x has no public API for adding text box shapes to a drawing. The xlsx is saved to BytesIO, then reopened as a zip. The drawing XML for each affected sheet is modified by injecting `<xdr:absoluteAnchor>` elements before `</xdr:wsDr>`. Namespace prefixes (`xdr:`, `a:`) are inherited from the existing root element.
- **Label coordinates**: stored as 0–1 fractions (`label_x`, `label_y`) of the image viewport. Converted to EMU: `x = label_x × IMG_W_PX × 9525`, `y = IMG_ROW_OFFSET_EMU + label_y × IMG_H_PX × 9525`. `IMG_ROW_OFFSET_EMU` assumes default 15pt row height for rows 1–2.
- **Shape ID**: set as `existing_sp_count + 1 + i`. Counted via string search (`xml.count("<xdr:sp")`); avoids XML parsing for speed. IDs only need to be unique within the drawing.
- **`total` column**: computed at export time as `quantity × utility_count`, same formula as the API endpoint. Never stored.
- **Sheet title truncation**: Excel limits sheet names to 31 characters. Typical names longer than 31 chars are truncated silently.
