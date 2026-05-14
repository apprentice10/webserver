# static/engine/js/etl-editor/etl-expr.js

**Description:** SQL-grammar expression parser and renderer for the ETL form editor. Converts user-typed text to/from the v1 AST node format stored in `EtlModel`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–57 | `tokenize(text)` | Lexer: text → token array. Recognises SQL keywords (AND/OR/NOT/NULL/IS/CASE/WHEN/THEN/ELSE/END), strings, numbers, identifiers, operators. |
| 59–175 | `parseExpr(text)` | Recursive-descent parser: text → AST node or `null` for empty input. Throws `Error` with message on syntax failure. Grammar: OR → AND → NOT → CMP → ADD → MUL → PRIMARY. |
| 177–221 | `exprToText(expr)` | AST node → display string for `<input>` values. No parentheses — the backend compiler adds them. Legacy `expr_sql` nodes render their `.sql` field for migration display. |

## Decisions

- **Extracted from `etl_editor.js` (P4-E1)**: these three functions were pure (no module state, no DOM) — ideal extraction candidates. `etl_editor.js` calls `EtlExpr.parseExpr(...)` and `EtlExpr.exprToText(...)`. `_applyExpr` stays in `etl_editor.js` because it calls `_scheduleCompile()` (closure coupling).
- **Distinct from `EtlDsl`**: `EtlDsl` uses `||`/`&&` canvas-formula syntax with `case(a,b,c)` function style. `EtlExpr` uses SQL keyword syntax (`AND`/`OR`, `CASE WHEN ... THEN ... END`). Both produce the same AST node shapes but serve different editors.
- **`expr_sql` backward compatibility**: legacy nodes (type `"expr_sql"`) are rendered as their `.sql` field. The compiler rejects them, prompting re-entry. This is display-only handling; no parsing of `expr_sql` nodes is performed.
- **Empty input returns `null`**: `parseExpr("")` returns `null`. `exprToText({})` returns `""`. Callers treat these as "no expression set".
