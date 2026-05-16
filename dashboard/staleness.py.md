# engine/staleness.py

**Description:** ETL staleness helpers — mark a tool stale and propagate staleness to its dependents.
Extracted from `engine/service.py` (RISKS.md R01 split).

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 11–12 | `mark_tool_stale` | SET is_stale=1 for one tool by slug |
| 15–24 | `mark_dependents_stale` | SET is_stale=1 for all tools whose etl_deps include source_slug |

## Decisions

- **Extracted module**: Moved here from `service.py` (was lines 40–55) to allow `service.py`
  to stay under the 400-line limit when new features are added. No behavior change.
- **No circular imports**: This module imports only `json` and `sqlite3`. Both `service.py`
  and `etl.py` import from here; neither is imported back.
- **`etl.py` deferred import**: `etl.py` imports `mark_dependents_stale` with a deferred
  `from engine.staleness import ...` inside `etl_run_saved` to preserve the existing
  deferred-import pattern (RISKS.md R06 guard).
