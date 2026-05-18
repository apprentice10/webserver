# routes_export.py

## Description
MTO V1 export routes. Two endpoints: a conflict-check GET and the export POST. Mirrors the import pattern in `routes_import.py` but writes to the destination DB instead of reading from it.

## Index
- 1–10: module docstring, imports
- 17–43: `_open_dest_db` — opens external `.db` for writing; validates path, extension, and presence of required MTO tables
- 45–51: `_dest_tool_id` — finds the first MTO tool_id in the destination DB; raises 422 if none
- 53–55: `_table_columns` — PRAGMA helper
- 59–70: `GET /export/check` — returns which of the given names conflict in the destination; called by Step 21 frontend before export
- 73–82: `_ExportBody` — payload model; `rename_map` maps str(typical_id) to new name, used by Step 21 conflict resolution
- 84–118: `POST /{tool_id}/export` — opens dest, resolves shared material columns once, then loops over typical_ids
- 120–172: `_copy_one` — handles overwrite-vs-create and copies materials, image, placements

## Decisions
- `_open_dest_db` uses `resolve(strict=True)` to reject non-existent paths and path-traversal attempts.
- Destination DB must already have MTO tables (opened previously as a project). No auto-init.
- `_dest_tool_id` picks the first MTO tool in the destination. If the destination has multiple MTO tools, only the first is used. Good enough for Step 20; revisit if multi-tool export is needed.
- `rename_map` keys are strings (JSON object keys are always strings); frontend must convert `typical_id` to string when building the map.
- `dest.commit()` runs once after the loop, not per-typical, so the whole batch is atomic.
- On conflict with `strategy != "overwrite"`, raises `ValueError` (not HTTPException) so the per-typical error is captured in `results` rather than aborting the whole batch.
