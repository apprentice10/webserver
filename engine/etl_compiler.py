from __future__ import annotations

from collections import deque
from typing import Any

from .etl_model import EtlModel, model_from_dict


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class EtlValidationError(Exception):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


class EtlCompilationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Expression → SQL (pure dispatch — no inspection of expr_sql content)
# ---------------------------------------------------------------------------

def expr_to_sql(expr: dict) -> str:
    t = expr.get("type", "")

    if t == "column_ref":
        column_name = expr.get("column_name", "")
        table_alias = expr.get("table_alias", "")
        if table_alias:
            return f"{table_alias}.{column_name}"
        return column_name

    if t == "literal":
        value = expr.get("value")
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, str):
            escaped = value.replace("'", "''")
            return f"'{escaped}'"
        return str(value)

    if t == "binary_op":
        left_sql = expr_to_sql(expr["left"])
        right_sql = expr_to_sql(expr["right"])
        op = expr["op"]
        return f"({left_sql} {op} {right_sql})"

    if t == "function_call":
        name = expr["name"]
        args_sql = ", ".join(expr_to_sql(a) for a in expr.get("args", []))
        return f"{name}({args_sql})"

    if t == "expr_sql":
        # Opaque — emitted verbatim, never inspected
        return expr["sql"]

    raise EtlCompilationError(f"Unknown expression type: {t!r}")


# ---------------------------------------------------------------------------
# Topological sort — Kahn's algorithm
# Raises EtlCompilationError immediately on cycle detection.
# ---------------------------------------------------------------------------

def _kahn_sort(graph: dict) -> list[str]:
    all_nodes = set(graph.keys())
    successors: dict[str, list[str]] = {rid: [] for rid in all_nodes}
    in_degree: dict[str, int] = {rid: 0 for rid in all_nodes}

    for rid, deps in graph.items():
        for dep in deps:
            if dep in successors:           # only track edges between known nodes
                successors[dep].append(rid)
                in_degree[rid] += 1

    queue: deque[str] = deque(rid for rid in all_nodes if in_degree[rid] == 0)
    result: list[str] = []

    while queue:
        node = queue.popleft()
        result.append(node)
        for succ in successors[node]:
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(result) != len(all_nodes):
        # Cycle detected — mandatory hard error, never swallowed or demoted to warning
        raise EtlCompilationError(
            "Cycle detected in transformation dependency graph"
        )

    return result


# ---------------------------------------------------------------------------
# Ancestor traversal (BFS from a relation backwards through inputs)
# ---------------------------------------------------------------------------

def _collect_ancestors(relation_id: str, graph: dict) -> set[str]:
    visited: set[str] = set()
    stack = [relation_id]
    while stack:
        rid = stack.pop()
        if rid in visited:
            continue
        visited.add(rid)
        for dep in graph.get(rid, set()):
            stack.append(dep)
    return visited


# ---------------------------------------------------------------------------
# Output alias inference (used only for ORDER BY scope validation)
# ---------------------------------------------------------------------------

def _output_aliases_for(relation_id: str, model: EtlModel) -> set[str]:
    for tr in model.transformations:
        if tr["id"] != relation_id:
            continue
        tr_type = tr.get("type", "")
        if tr_type == "select":
            return {col["alias"] for col in tr.get("columns", [])}
        if tr_type == "aggregate":
            aliases = {col["alias"] for col in tr.get("aggregations", [])}
            for g in tr.get("group_by", []):
                if g.get("type") == "column_ref":
                    aliases.add(g.get("column_name", ""))
            return aliases
        if tr_type == "compute_column":
            input_id = tr.get("inputs", [""])[0]
            base = _output_aliases_for(input_id, model)
            base.add(tr.get("column", {}).get("alias", ""))
            return base
        if tr_type in ("filter", "join"):
            input_id = tr.get("inputs", [""])[0]
            return _output_aliases_for(input_id, model)
    return set()   # source — schema not statically known


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_model(model: EtlModel) -> list[str]:
    errors: list[str] = []

    source_ids = {s["id"] for s in model.sources}
    transformation_ids = {t["id"] for t in model.transformations}
    all_relation_ids = source_ids | transformation_ids

    # Check 1: final_relation_id
    if not model.final_relation_id:
        errors.append("final_relation_id is required and must not be empty")
    elif model.final_relation_id not in all_relation_ids:
        errors.append(
            f"final_relation_id '{model.final_relation_id}' does not reference a valid relation"
        )

    # Check 4: no duplicate relation ids
    seen_relation_ids: set[str] = set()
    for rid in [s["id"] for s in model.sources] + [t["id"] for t in model.transformations]:
        if rid in seen_relation_ids:
            errors.append(f"Duplicate relation id: '{rid}'")
        seen_relation_ids.add(rid)

    # Check 10: sources non-empty
    if not model.sources:
        errors.append("model.sources must not be empty")

    # Check 2: all inputs reference valid relation ids
    for tr in model.transformations:
        for inp in tr.get("inputs", []):
            if inp not in all_relation_ids:
                errors.append(
                    f"Transformation '{tr['id']}' references unknown input relation '{inp}'"
                )

    # Build dependency graph for cycle check and path analysis
    graph: dict[str, set[str]] = {}
    for s in model.sources:
        graph[s["id"]] = set()
    for tr in model.transformations:
        graph[tr["id"]] = set(tr.get("inputs", []))

    # Check 3: cycle detection — MANDATORY hard error
    try:
        _kahn_sort(graph)
    except EtlCompilationError as exc:
        errors.append(str(exc))
        return errors   # cannot safely continue without a valid DAG

    # Check 5 & 6: column ids unique and non-empty
    col_ids: list[str] = []
    for tr in model.transformations:
        tr_type = tr.get("type", "")
        if tr_type == "select":
            for col in tr.get("columns", []):
                col_ids.append(col.get("id", ""))
        elif tr_type == "aggregate":
            for col in tr.get("aggregations", []):
                col_ids.append(col.get("id", ""))
        elif tr_type == "compute_column":
            col_ids.append(tr.get("column", {}).get("id", ""))

    seen_col_ids: set[str] = set()
    for cid in col_ids:
        if not cid:
            errors.append("Column id must not be empty")
        elif cid in seen_col_ids:
            errors.append(f"Duplicate column id: '{cid}'")
        seen_col_ids.add(cid)

    # Per-transformation checks
    for tr in model.transformations:
        tr_type = tr.get("type", "")
        tr_id = tr.get("id", "?")

        # Check 7 & 8: JOIN referential integrity
        if tr_type == "join":
            left_input = tr.get("left_input", "")
            if left_input not in tr.get("inputs", []):
                errors.append(
                    f"JOIN '{tr_id}': left_input '{left_input}' must be listed in inputs"
                )
            right_source = tr.get("right_source", "")
            if right_source not in source_ids:
                errors.append(
                    f"JOIN '{tr_id}': right_source '{right_source}' is not a known source id"
                )

        # Check 9: filter mode
        if tr_type == "filter":
            mode = tr.get("mode", "")
            if mode not in ("where", "having"):
                errors.append(
                    f"FILTER '{tr_id}': mode must be 'where' or 'having', got '{mode!r}'"
                )

        # Check 12: aggregate column validity
        # Bare ColumnRef in aggregations must appear in group_by.
        # expr_sql expressions are EXEMPT — opaque, not validated for correctness.
        # Structured expressions MUST be validated.
        if tr_type == "aggregate":
            group_by = tr.get("group_by", [])
            group_by_col_refs = set()
            for g in group_by:
                if g.get("type") == "column_ref":
                    alias = g.get("table_alias", "")
                    name = g.get("column_name", "")
                    group_by_col_refs.add(f"{alias}.{name}" if alias else name)

            for col in tr.get("aggregations", []):
                expr = col.get("expr", {})
                expr_type = expr.get("type", "")
                if expr_type == "column_ref":
                    alias = expr.get("table_alias", "")
                    name = expr.get("column_name", "")
                    col_sql = f"{alias}.{name}" if alias else name
                    if col_sql not in group_by_col_refs:
                        errors.append(
                            f"AGGREGATE '{tr_id}': column '{col.get('alias', '')}' uses bare "
                            f"ColumnRef '{col_sql}' that is not in group_by and not inside a function"
                        )
                # function_call, binary_op, literal: no restriction
                # expr_sql: intentionally exempt — tradeoff for UI simplicity

    # Check 11: at least one SELECT or AGGREGATE on path to final_relation_id
    if model.final_relation_id in all_relation_ids:
        ancestors = _collect_ancestors(model.final_relation_id, graph)
        path_types = {
            tr.get("type") for tr in model.transformations if tr["id"] in ancestors
        }
        if "select" not in path_types and "aggregate" not in path_types:
            errors.append(
                "At least one SELECT or AGGREGATE transformation must exist on "
                "the dependency path to final_relation_id"
            )

    # Check 13: ORDER BY scope — ColumnRef expressions must exist in final relation output.
    # expr_sql expressions in order_by are EXEMPT — intentionally not validated.
    if model.final_relation_id in all_relation_ids:
        final_aliases = _output_aliases_for(model.final_relation_id, model)
        if final_aliases:   # empty means unknown schema — skip check
            for ob in model.order_by:
                expr = ob.get("expr", {})
                if expr.get("type") == "column_ref":
                    col_name = expr.get("column_name", "")
                    if col_name not in final_aliases:
                        errors.append(
                            f"ORDER BY references column '{col_name}' "
                            f"not available in final relation scope"
                        )

    return errors


# ---------------------------------------------------------------------------
# SQL compiler
# ---------------------------------------------------------------------------

def compile_sql(model: Any) -> str:
    # Step 0 — Normalize & Validate
    if isinstance(model, dict):
        model = model_from_dict(model)

    errors = validate_model(model)
    if errors:
        raise EtlValidationError(errors)

    # Step 1 — Build relation registry
    relations: dict[str, dict] = {}

    for source_dict in model.sources:
        relations[source_dict["id"]] = {
            "type": "source",
            "source": source_dict,
            "inputs": [],
        }

    for tr_dict in model.transformations:
        relations[tr_dict["id"]] = {
            "type": tr_dict["type"],
            "transformation": tr_dict,
            "inputs": tr_dict.get("inputs", []),
        }

    # Step 2 — Build dependency graph
    graph: dict[str, set[str]] = {}
    for rid, node in relations.items():
        graph[rid] = set(node["inputs"])

    # Step 3 — Topological sort (mandatory — failure raises immediately)
    execution_order = _kahn_sort(graph)

    # Step 4 — Initialize runtime structures
    sql_map: dict[str, str] = {}    # relation_id -> SQL string
    cte_map: dict[str, str] = {}    # cte_name -> sql
    scope_map: dict[str, set] = {}  # relation_id -> set[(alias, column_name)]

    # Step 5 — Process relations in topological order
    for rid in execution_order:
        node = relations[rid]

        # CASE 1 — Source
        if node["type"] == "source":
            source = node["source"]
            src_type = source.get("type", "")
            alias_part = f" {source['alias']}" if source.get("alias") else ""

            if src_type == "table":
                sql_map[rid] = f"(SELECT * FROM {source['name']}{alias_part})"

            elif src_type == "cte":
                cte_map[source["name"]] = source["sql"]   # DO NOT PARSE
                sql_map[rid] = f"(SELECT * FROM {source['name']})"

            else:
                # subquery or unknown — treat like table
                sql_map[rid] = f"(SELECT * FROM {source['name']}{alias_part})"

        # CASE 2 — SELECT
        elif node["type"] == "select":
            tr = node["transformation"]
            input_id = tr["inputs"][0]
            base_sql = sql_map[input_id]
            cols = ", ".join(
                f"{expr_to_sql(col['expr'])} AS {col['alias']}"
                for col in tr.get("columns", [])
            )
            sql_map[rid] = f"(SELECT {cols} FROM {base_sql})"

        # CASE 3 — FILTER
        elif node["type"] == "filter":
            tr = node["transformation"]
            input_id = tr["inputs"][0]
            base_sql = sql_map[input_id]
            condition = expr_to_sql(tr["condition"])

            if tr["mode"] == "where":
                sql_map[rid] = f"(SELECT * FROM {base_sql} WHERE {condition})"
            else:   # having
                sql_map[rid] = f"(SELECT * FROM {base_sql} HAVING {condition})"

        # CASE 4 — JOIN
        elif node["type"] == "join":
            tr = node["transformation"]
            left_id = tr["left_input"]
            left_sql = sql_map[left_id]

            right_node = relations[tr["right_source"]]
            right_source = right_node["source"]

            if right_source.get("type") == "table":
                right_sql = f"(SELECT * FROM {right_source['name']})"
            else:
                right_sql = sql_map[tr["right_source"]]

            join_type = tr.get("join_type", "inner").upper()
            alias = tr.get("alias", "")
            alias_part = f" AS {alias}" if alias else ""
            condition = expr_to_sql(tr["condition"])

            sql_map[rid] = (
                f"(SELECT * FROM {left_sql} "
                f"{join_type} JOIN {right_sql}{alias_part} ON {condition})"
            )

        # CASE 5 — AGGREGATE
        elif node["type"] == "aggregate":
            tr = node["transformation"]
            input_id = tr["inputs"][0]
            base_sql = sql_map[input_id]

            group_exprs = [expr_to_sql(g) for g in tr.get("group_by", [])]
            agg_exprs = [
                f"{expr_to_sql(col['expr'])} AS {col['alias']}"
                for col in tr.get("aggregations", [])
            ]
            select_parts = group_exprs + agg_exprs
            select_sql = ", ".join(select_parts)
            group_by_sql = ", ".join(group_exprs)

            sql_map[rid] = (
                f"(SELECT {select_sql} FROM {base_sql} GROUP BY {group_by_sql})"
            )

        # CASE 6 — COMPUTE COLUMN
        elif node["type"] == "compute_column":
            tr = node["transformation"]
            input_id = tr["inputs"][0]
            base_sql = sql_map[input_id]
            col = tr["column"]
            new_col_sql = f"{expr_to_sql(col['expr'])} AS {col['alias']}"
            sql_map[rid] = f"(SELECT *, {new_col_sql} FROM {base_sql})"

    # Step 6 — Resolve final relation
    final_id = model.final_relation_id
    if final_id not in sql_map:
        raise EtlCompilationError(
            f"Final relation '{final_id}' was not produced during compilation"
        )

    final_sql = sql_map[final_id]

    # Unwrap the outer parens: the final output is a top-level SELECT, not a subquery
    if final_sql.startswith("(") and final_sql.endswith(")"):
        final_sql = final_sql[1:-1]

    # Step 7 — ORDER BY
    if model.order_by:
        order_parts = [
            f"{expr_to_sql(ob['expr'])} {ob.get('direction', 'asc').upper()}"
            for ob in model.order_by
        ]
        final_sql = f"{final_sql} ORDER BY {', '.join(order_parts)}"

    # Step 8 — WITH clause
    if cte_map:
        cte_clauses = ", ".join(
            f"{name} AS ({sql})" for name, sql in cte_map.items()
        )
        final_sql = f"WITH {cte_clauses} {final_sql}"

    # Step 9 — Return SQL
    return final_sql
