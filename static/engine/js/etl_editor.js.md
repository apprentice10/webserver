# static/engine/js/etl_editor.js

**Description:** ETL Editor standalone — used by `/tool/{pid}/{tid}/etl`. Model-first architecture: maintains an `EtlModel` JS object as state; SQL is compiled on demand via `POST /etl/compile`. Expressions are stored as structured AST nodes (v1 grammar) and round-tripped through a mini expression parser/renderer.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_model` | state | EtlModel plain JS object (sources, transformations, final_relation_id, order_by, meta) |
| `_activeExprEl` | state | Last focused expr `<input>` — schema column click inserts here |
| `_tokenize(text)` | internal | Tokenizer for the expression mini-parser; returns token array |
| `_parseExpr(text)` | internal | Recursive descent parser: text → AST node (or null for empty); throws on syntax error |
| `_exprToText(node)` | internal | AST node → display text for `<input>` value; no parens (compiler adds them) |
| `_applyExpr(text, el, setter)` | internal | Parse + call setter + error styling; red border + `title` tooltip on parse failure |
| `setToolType(type)` | public | Injected by Jinja2 before `init()` |
| `init()` | public | Loads `etlLoadConfig` → populates `_model` + history; calls `_renderModel()`, `refreshSchema()`, `refreshTemplates()` |
| `_renderModel()` | internal | Renders all 4 sections: sources, transformations, final relation, order by; schedules compile |
| `_renderSources()` | internal | Renders source cards with alias input + remove button |
| `_renderTransformations()` | internal | Renders transformation cards; dispatches to type-specific body renderer |
| `_renderSelectBody(t)` | internal | Column rows (alias + expr via `_exprToText`) + add button |
| `_renderFilterBody(t)` | internal | Condition expr + WHERE/HAVING mode select |
| `_renderJoinBody(t)` | internal | join_type, left_input, right_source, alias, ON condition |
| `_renderAggregateBody(t)` | internal | GROUP BY exprs + aggregation columns |
| `_renderComputeBody(t)` | internal | Single alias + expr pair |
| `_renderFinalRelation()` | internal | Dropdown listing all relation ids; auto-sets to last transformation |
| `_renderOrderBy()` | internal | Order by rows with expr + ASC/DESC |
| `refreshSchema()` | public | Loads `etlLoadSchema`, renders schema browser |
| `insertColumn(toolSlug, colSlug)` | public | Called by schema column click: adds source if absent, inserts `alias.col` text into `_activeExprEl`; triggers `change` event so parse runs immediately |
| `_setActiveExpr(el)` | public (inline) | Sets `_activeExprEl`; called via `onfocus` on expr inputs |
| `addSourcePrompt()` | public | Prompts for slug + alias, calls `_addSource()` |
| `addTransformation(type)` | public | Appends new transformation with auto-inputs from last relation; sets `final_relation_id` |
| `addOrderBy()` | public | Pushes empty order-by entry |
| `preview()` | public | `POST /etl/preview` with `{model: _model}` |
| `apply()` | public | Requires prior preview; `POST /etl/apply`; auto-saves draft on success |
| `saveVersion()` | public | `POST /etl/save` with label; updates history |
| `loadVersion(i)` | public | Restores `_model` from `_history[i].model` |
| `_scheduleCompile()` | internal | Debounced 400ms; calls `_compileAndShow()` |
| `_compileAndShow()` | internal | `POST /etl/compile` → updates `#etl-compiled-sql` readonly textarea |
| `saveAsTemplate()` | public | Saves `JSON.stringify(_model)` as `etl_sql` in template record |
| `loadTemplate(id)` | public | Parses `etl_sql` as JSON model; warns if old SQL format |
| `importFromFile()` | public | Reads `.json` file, sets `_model` |
| `exportToFile()` | public | Downloads model as `.json` |
| `importFromSql()` | public | Opens inline modal; user pastes raw SQL; calls `POST /etl/sql_to_model`; loads returned model into `_model` |
| `_ea(str)` | internal | HTML attribute escaping (`&`, `"`, `'`) |

## Decisions

- **Structured expression grammar v1**: All expression inputs are parsed into AST nodes (`column_ref`, `literal`, `function`, `binary_op`, `logical`, `unary_op`, `is_null`, `is_not_null`, `case`). `expr_sql` is no longer emitted for new expressions.
- **Mini expression parser (`_parseExpr`)**: Recursive descent; handles the full v1 grammar including CASE, IS NULL, AND/OR chains, arithmetic, and nested function calls. Throws on unknown syntax — the error is shown as a red border + tooltip on the input. The model is NOT updated when parsing fails, preserving the last valid state.
- **`_exprToText` for round-tripping**: Converts stored AST nodes back to human-readable text for display in `<input>` fields. No parentheses — those are the compiler's responsibility. Legacy `expr_sql` nodes display their `.sql` field for migration purposes (they will fail backend validation).
- **`_applyExpr` as parse helper**: All expression update functions (`_updateColExpr`, `_updateFilterCond`, etc.) call `_applyExpr(text, el, setter)` which handles parse, error styling, and model update in a single place.
- **Empty expressions use `{}`**: New columns/conditions start with `expr: {}`. This passes through `_exprToText` as `""` (empty input). The compiler emits a validation error "expression missing 'type'" which appears in the compile panel, prompting the user to fill it in.
- **`expr_sql` backward compatibility**: Loaded models with legacy `expr_sql` nodes render their `.sql` field as display text. The compiler rejects them with "unknown expression type 'expr_sql'", visible in the compile panel, guiding the user to re-enter the expression.
- **Inline event handlers**: Mutation functions accept an optional `el` (the input element) for error styling. All inline `onchange` calls pass `this`.
- **`_activeExprEl`**: schema column clicks target the last focused expr `<input>`. If no input is focused, the snippet is copied to clipboard.
- **Template backward compatibility**: templates store model as JSON in `etl_sql` DB column. Old SQL-based templates are detected (parse failure or missing `.sources`) and rejected with a warning.
- **Auto `final_relation_id`**: adding a transformation auto-advances `final_relation_id`. Removing one falls back to `_lastRelationId()`.
- **`etlSaveDraft` on apply**: after a successful apply, the model is persisted silently via `PATCH /etl/config` to keep `etl_model` in sync without adding a history entry.
