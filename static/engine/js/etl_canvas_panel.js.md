# static/engine/js/etl_canvas_panel.js

**Description:** Side-panel IIFE for the visual ETL canvas editor. Renders a type-specific configuration form for each node kind (source, select, filter, join, aggregate, compute_column, generate_series, cte, destination) and writes edits back into the live `_model` via an `onChange` callback.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `DEST_ID` | const | `'__destination__'` — matches the synthetic node in `etl_canvas_editor.js` |
| `_onChange` | state | Callback supplied by `etl_canvas_editor.js`; called after any model mutation to trigger a canvas re-render |
| `close()` | public | Removes `.ecv-panel--open` from `#ecv-panel` |
| `_sourceHtml(node)` | internal | Read-only display for `table` sources: name, alias, type |
| `_destHtml(toolCols)` | internal | Tool column list (read-only) |
| `_colListHtml(cols)` | internal | Renders column rows: alias input + formula input + error div + remove button; uses `EtlDsl.serialize` for formula display |
| `_gbListHtml(exprs)` | internal | Renders group-by expression rows: formula input + remove button |
| `_selectHtml(node)` | internal | Column list wrapped in `#ecv-cols` + add button |
| `_filterHtml(node)` | internal | Mode select + condition formula textarea |
| `_joinHtml(node, sourceList)` | internal | Join-type select + right-source select + condition formula textarea + projection column list |
| `_aggregateHtml(node)` | internal | Group-by list (`#ecv-gb`) + aggregations list (`#ecv-agg`), each with add button |
| `_computeColHtml(node)` | internal | Single new-column alias input + formula textarea |
| `_genSeriesHtml(node)` | internal | Alias input + start integer input + end_expr formula textarea |
| `_cteHtml(node)` | internal | Name + alias text inputs + SQL textarea (raw SQL, not DSL) |
| `_bindFormulaBar(id, onSave)` | internal | Attaches blur listener: parses formula with `EtlDsl.tryParse`, shows error or calls `onSave(ast)` |
| `_bindColList(node)` | internal | Delegated listeners on `#ecv-cols`: blur for alias/formula edits, click for remove/add — operates on `node.columns` |
| `_bindGbList(node)` | internal | Delegated listeners on `#ecv-gb` for group-by expressions: blur, remove, add |
| `_bindAggColList(node)` | internal | Delegated listeners on `#ecv-agg` for aggregation columns: blur for alias/formula, remove, add — operates on `node.aggregations` |
| `_bindPanel(node, sourceList)` | internal | Wires all events for the current node; type-dispatches to `_bindColList`, `_bindGbList`+`_bindAggColList`, compute/generate_series/cte inline bindings |
| `open(nodeId, model, sourceList, toolCols, onChange)` | public | Main entry point; renders and opens the panel for the given node id |

## Decisions

- **In-place model mutation**: `EtlCanvasPanel` receives `_model` by reference. Node property edits mutate the shared model directly. `onChange()` (no args) then calls `_render()` in `etl_canvas_editor.js` to refresh the canvas node cards. No full panel re-render occurs on edit — only on add/remove.
- **Column list re-render on structural change**: On add/remove column, `cols.innerHTML = _colListHtml(...)` replaces only the list rows inside the persistent container. Delegated listeners on the container survive this replacement. The same pattern applies to group-by (`#ecv-gb`) and aggregations (`#ecv-agg`).
- **Separate `_bindColList` / `_bindAggColList`**: Rather than a generic function taking a field name parameter, two dedicated functions keep the code readable and avoid accidental cross-wiring. The underlying logic is identical; the difference is the container ID and the node property accessed.
- **`_bindPanel` type-dispatch**: The filter/join ID-based wire-ups are safe to call for any node type (they no-op if the IDs don't exist in the DOM). The column-list binding is type-dispatched via `if (node.type === ...)` to avoid attaching two listeners to the same container.
- **CTE SQL is raw, not DSL**: CTE bodies are arbitrary SQL subqueries. DSL parsing is not applied; the textarea value is written to `node.sql` directly on blur.
- **`table` is the only non-editable source**: `generate_series` and `cte` sources have editable fields and call `_bindPanel`. Only `type === 'table'` skips binding.
- **`EtlDsl` dependency**: This module calls `EtlDsl.serialize` and `EtlDsl.tryParse`. Script load order in `etl.html` must place `etl_dsl.js` before this file.
- **Fallback to raw JSON**: Unknown node types fall through to a `<pre>` JSON dump, matching Phase 1 behavior.
