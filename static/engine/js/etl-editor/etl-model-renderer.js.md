# static/engine/js/etl-editor/etl-model-renderer.js

**Description:** Stateless DOM renderers for all EtlEditor sections. Takes model/history/templates as explicit params and writes to fixed DOM IDs. No access to EtlEditor closure state.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 3–10 | `_esc`, `_formatTs`, `_ea` | Local aliases: `Utils.escHtml`, `Utils.formatTimestamp`, attribute escaper |
| 13–29 | `renderSources(model)` | Writes source cards to `#etl-sources-list` |
| 32–65 | `renderTransformations(model)` | Writes transformation cards to `#etl-transformations-list`; dispatches to type-body renderers |
| 67–73 | `_renderTransformation(t)` | Returns HTML string for one transformation card (header + type body) |
| 75–93 | `_renderSelectBody(t)` | HTML for SELECT column rows + add button |
| 95–110 | `_renderFilterBody(t)` | HTML for FILTER condition + WHERE/HAVING select |
| 112–139 | `_renderJoinBody(t)` | HTML for JOIN type, left/right inputs, ON condition |
| 141–166 | `_renderAggregateBody(t)` | HTML for GROUP BY expr rows + aggregation column rows |
| 168–182 | `_renderComputeBody(t)` | HTML for COMPUTE COLUMN alias + expr |
| 185–206 | `renderFinalRelation(model)` | Writes final relation dropdown to `#etl-final-relation`; pure — no mutation |
| 208–225 | `renderOrderBy(model)` | Writes order-by rows to `#etl-orderby-list` |
| 228–241 | `renderHistory(history)` | Writes version history items to `#etl-history-list` |
| 243–257 | `renderTemplatesList(templates, el)` | Writes template items into the passed `el` |
| 260–300 | `renderSchema(schema, container)` | Writes schema browser groups + columns; attaches accordion toggle listeners |

## Decisions

- **Extracted from `etl_editor.js` (P4-E2)**: all `_render*` functions moved here to isolate DOM rendering from state/mutation logic.
- **Explicit params, no closure**: every public function receives its data as a parameter. `renderFinalRelation(model)` is read-only — `_model.final_relation_id` normalization was moved to `_renderModel()` in `etl_editor.js`.
- **Inline event handlers reference `EtlEditor.*`**: generated HTML strings use `onclick="EtlEditor._updateSourceAlias(...)"` etc. `EtlEditor` is globally visible; this is intentional and matches the existing pattern.
- **`EtlExpr.exprToText`**: called directly for all expression display fields. Loaded before this module in `etl.html`.
- **`renderTemplatesList` takes `el` as param**: the caller (`refreshTemplates`) already has the element reference; passing it avoids a redundant `getElementById` inside the renderer.
