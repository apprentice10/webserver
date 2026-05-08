# static/engine/js/etl_dsl.js

**Description:** Restricted DSL parser and serializer IIFE. Converts formula strings like `concat_ws('', 'C-', il_tag, case(n > 1, '.', ''))` to ETL AST nodes and back. The server never receives formula strings — only ASTs.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_tokenize(src)` | internal | Produces token array: STR, NUM, ID, OP (incl. `<=`,`>=`,`!=`,`\|\|`,`&&`), LP, RP, CM, DT, EOF |
| `_tok`, `_p` | state | Token array and position for the recursive-descent parser (module-level, reset on each `parse()` call) |
| `_peek()`, `_eat()`, `_is(t,v)` | internal | Token lookahead and consume helpers |
| `_expr()` … `_unary()` | internal | Recursive-descent layers: or → and → compare → add → mul → unary → primary |
| `_primary()` | internal | Handles literals, parenthesised exprs, function calls, `table.col` refs, bare column refs, keywords (`null`, `true`, `false`) |
| `_buildFn(name, args)` | internal | Dispatches function names to special AST types: `case`, `not_null`, `is_null`, `and`, `or`; everything else → `{type:'function', name:UPPER, args}` |
| `serialize(ast)` | public | AST → formula string; handles all ETL AST node types |
| `parse(src)` | public | Formula string → AST; throws `Error` on syntax errors |
| `tryParse(src)` | public | Safe wrapper: returns `{ast, error}` — never throws |

## Decisions

- **`case(cond1, val1, cond2, val2, ..., else)` syntax**: Flat alternating pairs, optional trailing else. Even-indexed args are conditions, odd-indexed are values, odd total = last arg is else. Maps directly to `{type:'case', when_clauses:[...], else}`. Chosen over SQL `CASE WHEN … END` for brevity in formula bars.
- **`not_null(expr)` / `is_null(expr)` instead of postfix**: Keeps every expression a prefix call or infix op — simpler to parse, simpler to serialize.
- **`and(…)` / `or(…)` as variadic functions**: The logical AST node already has `args: expr[]`. Representing them as variadic functions avoids the need for infix `&&`/`||` at the expression level (those are still lexed but reduce to 2-arg logical nodes for the rare direct usage).
- **Column refs: `alias.col` or bare `col`**: `table_alias` is the part before `.`; bare identifiers get `table_alias: ''`. This matches the AST contract.
- **Server never sees formula strings**: `parse()` produces an AST; `EtlCanvasPanel` always writes the AST back to `_model`, not the string. `serialize()` is used only for display.
- **Module-level parser state (`_tok`, `_p`)**: The parser is not re-entrant, but formula bars are always parsed one at a time on blur events, so this is safe.
