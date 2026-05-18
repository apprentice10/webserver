# backend/service_etl.py

**Description:** MTO V1 ETL apply/run — compiles and executes the ETL model, writes results to `mto_utilities`, and auto-creates `mto_typicals` for any new `typical_name` values found. Called by the generic ETL apply/run routes when `tool_type == "mto"`.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `_compile_and_run` | 17 | Compile model → SQL → execute; returns `(columns, rows)` |
| `_validate_mto_columns` | 31 | Raises 422 if `tag` or `typical_name` are missing from ETL output |
| `_write_utilities_and_sync` | 38 | DELETE+INSERT into `mto_utilities`, then INSERT new `mto_typicals` |
| `_persist_model` | 71 | Saves `etl_model` + `etl_deps` into `_tools.query_config` |
| `mto_etl_apply` | 81 | Full apply: compile → validate → write → persist → commit |
| `mto_etl_run_saved` | 90 | Load saved model → full apply; clears `is_stale` flag |

## Decisions

- **Orphan-safe**: existing `mto_typicals` rows are never deleted when a `typical_name` disappears from ETL output. Orphaned pages stay visible until the user deletes them manually.
- `mto_utilities` is fully replaced on each run (DELETE all for tool_id, then INSERT). This is safe because `mto_utilities` is entirely ETL-owned — no manual edits.
- Required ETL output columns: `tag` and `typical_name`. Any extra columns in the ETL output are ignored at this stage (utilities display in Step 7 will pick up all columns).
- `_persist_model` mirrors what the generic `etl_apply` does so the saved model is available for `etl_run` later.
- Dispatched from `dashboard/routes_etl.py` via `tool_type == "mto"` check — avoids a second router at the same URL.
