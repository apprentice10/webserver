# engine/sql_to_model.py

**Description:** Best-effort SQL → EtlModel converter for migrating legacy SQL-based ETL to the model-first IR. Produces fully valid EtlModel AST — no `expr_sql` fallback.

Expression subsystem (`_EXPR_KEYWORDS`, `_tokenize_expr`, `_ExprParser`, `_try_rewrite_split_part`, `_parse_expr`) lives in `engine/sql_to_model_expr.py` (extracted P1-004b).
Lexer utilities (`_mask_strings`, `_unmask`, `_comma_split`, `_find_clauses`) live in `engine/sql_to_model_lexer.py` (extracted P1-004c).

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 22–36 | Imports — `re`, `uuid`, expression subsystem from `sql_to_model_expr`, lexer from `sql_to_model_lexer` |
| 39 | `_gen_id()` — generate short random IDs for model nodes |
| 41–107 | `_detect_generate_series_cte(name, sql, str_tbl)` — detect recursive/UNION-ALL number-generator CTEs; returns generate_series source dict or None |
| 109–155 | `_extract_ctes(sql, str_tbl)` — extract CTEs; delegates to `_detect_generate_series_cte` for each |
| 157–172 | `_unquote`, `_table_ref` — identifier helpers |
| 174–203 | `_parse_col_item(item, str_tbl)` — parse one SELECT list item |
| 205–213 | `_join_type(kw_text)` — extract uppercase join type |
| 219–388 | `sql_to_model(sql)` — main converter; passes `str_tbl` to `_extract_ctes` |

## Decisions

- **No `expr_sql` fallback**: All expressions must parse into valid v1 AST nodes. If parsing fails, a `ValueError` is raised and shown in the frontend error panel. This is the only safe choice since `expr_sql` is rejected by the compiler.
- **`||` → `CONCAT_WS`**: The `||` concatenation operator is forbidden in EtlModel. The `_concat_to_ast` method detects alternating `value || sep || value || sep || ...` patterns and converts to `CONCAT_WS(sep, values...)`. For non-alternating chains, uses `CONCAT_WS('', ...)`.
- **`= NULL` / `!= NULL` → `is_null` / `is_not_null`**: These SQL anti-patterns are silently fixed rather than raising an error, since they commonly appear in old SQL.
- **`AND`/`OR` always produce `logical` nodes**: Never `binary_op` — this matches the EtlModel spec.
- **String masking before clause scan**: Prevents keywords inside string literals (e.g., `WHERE 'FROM' = col`) from being misidentified as clause boundaries.
- **DISTINCT is silently dropped**: EtlModel has no SELECT DISTINCT concept. The user should add a GROUP BY or AGGREGATE transformation if deduplication is required.
- **JOIN type uppercase**: `_join_type` returns `"LEFT"`, `"RIGHT"`, `"INNER"`, `"FULL"` (uppercase) per EtlModel spec (section 5.3 of ETL_TEMPLATE_GUIDE.md).
- **JOINs paired with ON by index**: `join_queue[i]` paired with `on_queue[i]`. Missing ON → empty dict `{}` (compile will error, user must fill in).
- **`_extract_ctes` now takes `str_tbl`**: Required so `_detect_generate_series_cte` can parse the `end_expr` (which may contain masked string literals) correctly. Callers must pass the mask table.
- **CTE name regex handles column lists**: `nums(n) AS (...)` is now supported via the `(?:\([^)]*\)\s*)?` group in the CTE name pattern. The column list is discarded; the compiler infers the alias from `generate_series.alias`.
- **`WITH RECURSIVE` prefix handled in `_extract_ctes`**: The keyword is consumed by the updated opening regex so it doesn't interfere with CTE name parsing.
- **SPLIT_PART rewriting is best-effort**: Only the simplest `SUBSTR(s, 1, INSTR(s, d) - 1)` pattern is auto-detected. Deeper SUBSTR chains require manual rewriting to SPLIT_PART in the model editor.
- **generate_series detection is heuristic**: Uses two regex patterns (recursive CTE and UNION ALL of consecutive integers). CTEs that don't match are kept as regular CTE sources — no data is lost.
