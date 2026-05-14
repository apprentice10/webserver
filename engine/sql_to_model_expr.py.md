# engine/sql_to_model_expr.py

**Description:** SQL expression tokenizer, recursive-descent parser, and SPLIT_PART rewriter. Extracted from `sql_to_model.py` — zero dependencies on the rest of that module.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 14–18 | `_EXPR_KEYWORDS` — frozenset of SQL keywords that the tokenizer emits as typed tokens (not `IDENT`) |
| 22–110 | `_tokenize_expr(text, str_tbl)` — converts a masked SQL expression string to a token list; emits `STR`, `NUM`, `IDENT`, keyword tokens, `OP`, `CONCAT`, `LP`, `RP`, `COMMA`, `DOT`, `EOF` |
| 116–285 | `_ExprParser` — recursive-descent parser; grammar: `logical_or → logical_and → not → comparison → concat → add → mul → unary → primary`; CASE handled in `_case()` |
| 291–349 | `_try_rewrite_split_part(expr)` — post-parse AST rewriter: normalises `SPLIT_PART`, detects `SUBSTR(s,1,INSTR(s,d)-1)` → `SPLIT_PART(s,d,1)`, recurses into all node types |
| 352 | `_parse_expr(text, str_tbl)` — tokenize + parse + `_try_rewrite_split_part`; raises `ValueError` on failure; returns `{}` for empty input |

## Decisions

- **Extracted as a separate module (P1-004b)**: This group has zero internal dependencies on `sql_to_model.py`. Moving it out reduces `sql_to_model.py` from 895 → ~510 LOC and isolates the expression layer for independent unit testing.
- **No `expr_sql` fallback**: `_parse_expr` raises `ValueError` on any parse failure. This is intentional — `expr_sql` nodes are rejected by the compiler. Callers must handle the error and surface it to the user.
- **`||` → `CONCAT_WS`**: `_concat_to_ast` detects the alternating `value || sep || value` pattern and folds it into `CONCAT_WS(sep, values...)`. Non-alternating chains fall back to `CONCAT_WS('', ...)`.
- **`= NULL` / `!= NULL` auto-fix**: `_comparison` silently rewrites these SQL anti-patterns to `is_null` / `is_not_null` rather than raising, since they appear frequently in legacy SQL.
- **SPLIT_PART rewriting is best-effort**: Only `SUBSTR(s, 1, INSTR(s, d) - 1)` is auto-detected. Deeper SUBSTR chains require manual rewriting.
- **`AND`/`OR` always produce `logical` nodes**: Never `binary_op` — this matches the EtlModel v1 spec.
