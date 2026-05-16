# engine/sql_to_model_lexer.py

**Description:** SQL string masking, depth-0 comma splitting, and clause boundary extraction. Extracted from `sql_to_model.py` (P1-004c) — zero dependencies on any other module.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 17–50 | `_mask_strings(sql)` — replace `'...'` literals with `\x00Sn$` placeholders; returns `(masked_sql, tbl)` |
| 53–55 | `_unmask(s, tbl)` — restore `\x00Sn$` placeholders to their original string literals |
| 61–73 | `_comma_split(text)` — split at depth-0 commas, respecting nested parentheses |
| 79–94 | `_CLAUSE_PATTERNS`, `_COMPILED_CLAUSES` — ordered list of `(regex, tag)` for SQL clause boundaries |
| 97–123 | `_find_clauses(sql)` — scan masked SQL at paren-depth 0; returns `[(tag, kw_text, content)]` |

## Decisions

- **Extracted as a separate module (P1-004c)**: These five utilities have zero internal dependencies and are purely lexical. Moving them out reduces `sql_to_model.py` from ~510 → ~388 LOC and isolates the lexer layer for independent testing.
- **`_unmask` lives here, not in `sql_to_model_expr`**: Although the expression module also uses a `str_tbl`, it receives the table as a parameter and never calls `_unmask` directly. Keeping `_unmask` with `_mask_strings` (its only producer) avoids a cross-module dependency.
- **`_COMPILED_CLAUSES` is module-private**: Compiled once at import time from `_CLAUSE_PATTERNS`. Only `_find_clauses` uses it — not exported.
- **Clause scan skips nested parens**: `_find_clauses` tracks depth and only matches clause keywords at depth 0. This prevents subquery keywords from being treated as top-level clauses.
