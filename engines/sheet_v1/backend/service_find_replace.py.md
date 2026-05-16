---
# engines/sheet_v1/backend/service_find_replace.py

**Description:** Find/replace business logic and column autocomplete value fetcher for Sheet V1.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 11–17 | `_wildcard_to_regex` | Converts wildcard search string (`*`, `?`) to compiled `re.Pattern`; anchors with `^...$` when `match_entire_cell=True` |
| 20–60 | `find_replace_cells` | Iterates matching cells, delegates each replacement to `update_cell` (preserves audit trail and override tracking); returns `{count, rows}` |
| 63–96 | `get_column_values` | Returns distinct non-empty values from a user column, optionally prefix-filtered via SQL `LIKE`; raises 400 on system columns |

## Decisions

- **Delegates to `update_cell`**: each replacement goes through the standard cell-update path so audit, override tracking, and staleness marking are all consistent — no direct SQL writes here.
- **`scope=None` = full sheet**: when scope is omitted the function queries all active rows (`ORDER BY __position`) and all editable slugs; when scope is provided it trusts the caller to supply valid `{row_id, col_slug}` pairs.
- **`match_entire_cell=True` with wildcards**: the replacement value is always the literal `replacement` string (not a regex substitution) because the whole cell is replaced; without `match_entire_cell`, `pattern.sub` replaces only the matched portion(s).
- **`get_column_values` escapes LIKE specials** (`%`, `_`, `\`) before building the `LIKE` clause so user-typed prefixes are treated literally.
