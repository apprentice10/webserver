# engine/sql_to_model.py

**Description:** Best-effort SQL → EtlModel converter for migrating legacy SQL-based ETL to the model-first IR. Produces fully valid EtlModel AST — no `expr_sql` fallback.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 40–64 | `_mask_strings(sql)` — replace `'...'` literals with `\x00Sn$` placeholders |
| 66–68 | `_unmask(s, tbl)` — restore placeholders |
| 70–84 | `_comma_split(text)` — depth-0 comma split |
| 86–120 | `_find_clauses(sql)` — ordered `[(tag, kw_text, content)]` at paren-depth 0 |
| 122–145 | `_extract_ctes(sql)` — extract `WITH ... AS (...)` CTEs |
| 147–168 | `_unquote`, `_table_ref` — identifier helpers |
| 170–217 | `_tokenize_expr(text, str_tbl)` — SQL expression tokenizer; handles masked strings, `||`, double-quoted identifiers |
| 220–349 | `_ExprParser` — recursive-descent expression parser |
| 220 | `parse()` — entry point |
| 228 | `_logical_or` → `_logical_and` → `_not_expr` → `_comparison` |
| 258 | `_comparison` — handles `IS NULL`, `IS NOT NULL`, `= NULL` auto-fix |
| 272 | `_concat` — collects `||` chain → `_concat_to_ast` |
| 285 | `_concat_to_ast` — detects alternating value/sep pattern → `CONCAT_WS(sep, ...)` |
| 300 | `_add`, `_mul`, `_unary` — arithmetic |
| 318 | `_primary` — string/number/null/bool literals, function calls, column refs, `CASE` |
| 344 | `_case` — full CASE WHEN THEN ELSE END |
| 351 | `_parse_expr(text, str_tbl)` — public entry: tokenize + parse, raises `ValueError` on failure |
| 358–380 | `_parse_col_item(item, str_tbl)` — parse one SELECT list item into `{id, alias, expr}` |
| 382 | `_join_type(kw_text)` — extract uppercase join type from keyword text |
| 390–462 | `sql_to_model(sql)` — main converter |

## Decisions

- **No `expr_sql` fallback**: All expressions must parse into valid v1 AST nodes. If parsing fails, a `ValueError` is raised and shown in the frontend error panel. This is the only safe choice since `expr_sql` is rejected by the compiler.
- **`||` → `CONCAT_WS`**: The `||` concatenation operator is forbidden in EtlModel. The `_concat_to_ast` method detects alternating `value || sep || value || sep || ...` patterns and converts to `CONCAT_WS(sep, values...)`. For non-alternating chains, uses `CONCAT_WS('', ...)`.
- **`= NULL` / `!= NULL` → `is_null` / `is_not_null`**: These SQL anti-patterns are silently fixed rather than raising an error, since they commonly appear in old SQL.
- **`AND`/`OR` always produce `logical` nodes**: Never `binary_op` — this matches the EtlModel spec.
- **String masking before clause scan**: Prevents keywords inside string literals (e.g., `WHERE 'FROM' = col`) from being misidentified as clause boundaries.
- **DISTINCT is silently dropped**: EtlModel has no SELECT DISTINCT concept. The user should add a GROUP BY or AGGREGATE transformation if deduplication is required.
- **JOIN type uppercase**: `_join_type` returns `"LEFT"`, `"RIGHT"`, `"INNER"`, `"FULL"` (uppercase) per EtlModel spec (section 5.3 of ETL_TEMPLATE_GUIDE.md).
- **JOINs paired with ON by index**: `join_queue[i]` paired with `on_queue[i]`. Missing ON → empty dict `{}` (compile will error, user must fill in).
