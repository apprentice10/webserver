# VISUAL_ETL_CANVAS.md

**Description:** Design plan for the interactive visual ETL canvas — a DAG editor that sits alongside the existing code-view ETL editor on the same page, editing the same `etl_model`.

---

## Motivation

The existing ETL editor (code view) is fully functional but complex. A visual canvas will make it accessible for building and understanding pipelines without writing raw SQL or navigating the ETL model JSON directly. Both views are always in sync and cover the same feature set.

---

## Agreed Design

### 1. Views & Sync

- Canvas and code view live on the **same ETL editor page** (same URL: `/project/{id}/etl-editor/{tool_id}`).
- A **toolbar toggle** switches between views.
- Sync happens **on tab switch**: the view you leave compiles its current state into the shared `etl_model`; the view you enter renders from it.
- Both views support the full expression language — no second-class citizen view.

### 2. Canvas Interaction Model

- **Connections are node-level** (whole relation in → whole relation out). Individual column wiring is configured inside the node, not on the canvas.
- **Adding a node:** click the `+` button on a node's output port → small popup lists valid transform types → selected node appears and is connected automatically.
- **Configuring a node:** click the node → **side panel** slides in from the right showing the node's full configuration.
- **Column editing:** inside the side panel, each output column has a formula bar where you type an expression in the restricted DSL.

### 3. Expression Language (Restricted DSL)

- A **controlled formula syntax** (e.g. `concat(tag, '-', service)`, `split_part(cavo, '|', n)`, `case(n=1, val1, n=2, val2, null)`).
- Only approved functions exist — no raw SQL passthrough.
- **Parser lives in JS only** (client-side). The formula string is parsed to AST in the browser; the server always receives the AST, never formula strings.
- Full parity with code view: any expression expressible in the AST must be expressible in the DSL, and vice versa.
- DSL design is a **separate subsystem** — built in a second pass after the canvas shell.

### 4. Destination Node

- A **fixed Destination node** appears at the right edge of the canvas showing all target columns of the current tool.
- Each column slot can be **wired** (expression flows into it) or **left empty** (compiles to `NULL AS col_name`).
- The final `Select` node must connect into the Destination node to define the pipeline output (`final_relation_id`).

### 5. MVP Node Types

| Node Type | MVP | Later |
|---|---|---|
| Source — table | ✓ | |
| Source — generate_series | | ✓ |
| Source — CTE | | ✓ |
| Join | ✓ | |
| Filter | ✓ | |
| Select | ✓ | |
| Aggregate | | ✓ |
| Compute Column | | ✓ |

---

## Build Order

### Phase 1 — Canvas Shell (current focus)

1. Replace existing `etl_canvas.html` shell with new interactive canvas on the same URL.
2. Add view toggle (Canvas / Code) to the ETL editor toolbar.
3. Render existing `etl_model` as interactive nodes with pan/zoom/drag.
4. Implement `+` port button → transform type popup → new node added to model.
5. Implement side panel opening on node click (placeholder: raw AST JSON editor).
6. Implement Destination node (reads tool columns, accepts wired inputs).
7. Implement on-switch sync: canvas → model → code view, and code view → model → canvas.

### Phase 2 — Restricted DSL Formula Bar

1. Design DSL grammar (approved functions, column refs, literals, operators, case).
2. Implement JS parser: `formula string → AST node`.
3. Implement JS serializer: `AST node → formula string` (for round-tripping).
4. Replace raw AST editor in side panel formula bars with DSL formula bar + validation feedback.
5. Validate full parity with code view expressions.

### Phase 3 — Remaining Node Types

- Aggregate, Compute Column, generate_series, CTE sources.

---

## Files Touched (Phase 1)

| File | Change |
|---|---|
| `templates/etl_canvas.html` | Replace with new interactive canvas shell |
| `static/engine/js/etl_canvas.js` | Rewrite as interactive DAG editor |
| `static/engine/css/etl_canvas.css` | Update styles for new node cards, side panel, ports |
| `static/engine/js/etl_editor.js` | Add view toggle, on-switch sync logic |
| `templates/etl_editor.html` | Add toggle button in toolbar |

---

## Key Constraints

- **Vanilla JS only** — no framework, no build step. IIFE pattern.
- **No raw SQL in the model** — the canvas compiles to AST, not SQL strings.
- **Server receives AST only** — formula strings are a UI layer, never persisted.
- **Existing ETL compiler unchanged** — canvas is a new frontend for the same backend model.

---

## Related Context

- ETL model structure → `engine/etl.py.md`
- Staleness and topological run → `_context/ETL_STALENESS.md`
- Bidirectional ETL background → `_context/ETL_BIDIRECTIONAL.md`
- Frontend patterns (IIFE, script load order) → `_context/FRONTEND_PATTERNS.md`
- Existing ETL editor → `static/engine/js/etl_editor.js.md`
