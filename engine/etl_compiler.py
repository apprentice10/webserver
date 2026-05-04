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
# Expression grammar constants
# ---------------------------------------------------------------------------

_ALLOWED_BINARY_OPS = frozenset({"=", "!=", ">", "<", ">=", "<=", "+", "-", "*", "/"})

# Functions that require special argument-count validation (name → expected count)
_FIXED_ARITY_FUNCTIONS: dict[str, int] = {
    "SPLIT_PART": 3,
}

_SPLIT_PART_MAX_INDEX = 8   # compilation limit for literal-index SPLIT_PART


# ---------------------------------------------------------------------------
# SPLIT_PART → SQLite nested SUBSTR/INSTR compilation
# ---------------------------------------------------------------------------

def _sqlite_split_part(s: str, d: str, n: int) -> str:
    """Recursively build nested SQLite SQL to extract the nth delimiter-token from s."""
    if n == 1:
        return (
            f"CASE WHEN INSTR({s}, {d}) > 0 "
            f"THEN SUBSTR({s}, 1, INSTR({s}, {d}) - 1) "
            f"ELSE {s} END"
        )
    rest = f"SUBSTR({s}, INSTR({s}, {d}) + LENGTH({d}))"
    return _sqlite_split_part(rest, d, n - 1)


def _compile_split_part(args: list) -> str:
    if len(args) != 3:
        raise EtlCompilationError("SPLIT_PART requires exactly 3 arguments")
    n_arg = args[2]
    if n_arg.get("type") != "literal" or not isinstance(n_arg.get("value"), int):
        raise EtlCompilationError(
            "SPLIT_PART index (3rd arg) must be a literal integer in SQLite compilation mode"
        )
    n = n_arg["value"]
    if n < 1:
        raise EtlCompilationError("SPLIT_PART index must be >= 1")
    if n > _SPLIT_PART_MAX_INDEX:
        raise EtlCompilationError(
            f"SPLIT_PART index {n} exceeds SQLite compilation limit of {_SPLIT_PART_MAX_INDEX}"
        )
    s = expr_to_sql(args[0])
    d = expr_to_sql(args[1])
    return _sqlite_split_part(s, d, n)


# ---------------------------------------------------------------------------
# Expression → SQL
# Rules:
#   - column_ref  : always double-quoted
#   - literal     : NULL / TRUE / FALSE / 'escaped' / raw number
#   - function    : NAME(args...)  — name uppercased, no wrapping
#   - binary_op   : (left OP right)
#   - logical     : (arg AND arg AND arg)
#   - unary_op    : (NOT expr)
#   - is_null     : (expr IS NULL)
#   - is_not_null : (expr IS NOT NULL)
#   - case        : CASE [operand] WHEN … THEN … [ELSE …] END
# ---------------------------------------------------------------------------

def expr_to_sql(expr: dict) -> str:
    t = expr.get("type", "")

    if t == "literal":
        value = expr.get("value")
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, str):
            return "'" + value.replace("'", "''") + "'"
        return str(value)

    if t == "column_ref":
        col = f'"{expr["column_name"]}"'
        alias = expr.get("table_alias", "")
        return f'"{alias}".{col}' if alias else col

    if t == "function":
        name = expr["name"].upper()
        args = expr.get("args", [])
        if name == "SPLIT_PART":
            return _compile_split_part(args)
        args_sql = ", ".join(expr_to_sql(a) for a in args)
        return f"{name}({args_sql})"

    if t == "binary_op":
        left_sql  = expr_to_sql(expr["left"])
        right_sql = expr_to_sql(expr["right"])
        return f"({left_sql} {expr['op']} {right_sql})"

    if t == "logical":
        op   = expr["op"].upper()
        args = f" {op} ".join(expr_to_sql(a) for a in expr["args"])
        return f"({args})"

    if t == "unary_op":
        return f"(NOT {expr_to_sql(expr['expr'])})"

    if t == "is_null":
        return f"({expr_to_sql(expr['expr'])} IS NULL)"

    if t == "is_not_null":
        return f"({expr_to_sql(expr['expr'])} IS NOT NULL)"

    if t == "case":
        parts = ["CASE"]
        operand = expr.get("operand")
        if operand is not None:
            parts.append(expr_to_sql(operand))
        for clause in expr.get("when_clauses", []):
            parts.append(f"WHEN {expr_to_sql(clause['when'])} THEN {expr_to_sql(clause['then'])}")
        else_expr = expr.get("else")
        if else_expr is not None:
            parts.append(f"ELSE {expr_to_sql(else_expr)}")
        parts.append("END")
        return " ".join(parts)

    raise EtlCompilationError(f"Unknown expression type: {t!r}")


# ---------------------------------------------------------------------------
# Expression validation — recursive
# ---------------------------------------------------------------------------

def _validate_expr(expr: dict, errors: list[str], context: str = "") -> None:
    if not isinstance(expr, dict):
        errors.append(f"{context}: expression must be a dict, got {type(expr).__name__}")
        return

    t = expr.get("type", "")
    if not t:
        errors.append(f"{context}: expression missing 'type' field")
        return

    if t == "literal":
        v = expr.get("value")
        if not isinstance(v, (str, int, float, bool, type(None))):
            errors.append(f"{context}: literal value must be str, number, bool, or null")

    elif t == "column_ref":
        if not expr.get("column_name"):
            errors.append(f"{context}: column_ref.column_name must not be empty")

    elif t == "function":
        if not expr.get("name"):
            errors.append(f"{context}: function.name must not be empty")
        fname = expr.get("name", "").upper()
        args = expr.get("args", [])
        if fname in _FIXED_ARITY_FUNCTIONS:
            expected = _FIXED_ARITY_FUNCTIONS[fname]
            if len(args) != expected:
                errors.append(
                    f"{context}: {fname} requires exactly {expected} arguments, got {len(args)}"
                )
            if fname == "SPLIT_PART" and len(args) == 3:
                n_arg = args[2]
                if n_arg.get("type") != "literal" or not isinstance(n_arg.get("value"), int):
                    errors.append(
                        f"{context}: SPLIT_PART index (3rd arg) must be a literal integer"
                    )
                elif n_arg["value"] < 1:
                    errors.append(f"{context}: SPLIT_PART index must be >= 1")
                elif n_arg["value"] > _SPLIT_PART_MAX_INDEX:
                    errors.append(
                        f"{context}: SPLIT_PART index {n_arg['value']} exceeds "
                        f"limit of {_SPLIT_PART_MAX_INDEX}"
                    )
        for i, arg in enumerate(args):
            _validate_expr(arg, errors, f"{context}.args[{i}]")

    elif t == "binary_op":
        op = expr.get("op", "")
        if op.upper() in {"AND", "OR"}:
            errors.append(
                f"{context}: binary_op.op '{op}' is forbidden — use 'logical' for AND/OR"
            )
        elif op not in _ALLOWED_BINARY_OPS:
            errors.append(
                f"{context}: binary_op.op '{op}' is not allowed; "
                f"permitted: {sorted(_ALLOWED_BINARY_OPS)}"
            )
        # Reject = NULL — silent SQL NULL-comparison trap
        if op == "=":
            right = expr.get("right", {})
            left  = expr.get("left", {})
            if (right.get("type") == "literal" and right.get("value") is None) or \
               (left.get("type")  == "literal" and left.get("value")  is None):
                errors.append(f"{context}: '= NULL' is forbidden — use is_null / is_not_null")
        _validate_expr(expr.get("left",  {}), errors, f"{context}.left")
        _validate_expr(expr.get("right", {}), errors, f"{context}.right")

    elif t == "logical":
        op = expr.get("op", "")
        if op not in ("and", "or"):
            errors.append(f"{context}: logical.op must be 'and' or 'or', got '{op}'")
        args = expr.get("args", [])
        if len(args) < 2:
            errors.append(f"{context}: logical.args must have at least 2 elements")
        for i, arg in enumerate(args):
            _validate_expr(arg, errors, f"{context}.args[{i}]")

    elif t == "unary_op":
        if expr.get("op") != "not":
            errors.append(f"{context}: unary_op.op must be 'not' in v1, got '{expr.get('op')}'")
        _validate_expr(expr.get("expr", {}), errors, f"{context}.expr")

    elif t in ("is_null", "is_not_null"):
        _validate_expr(expr.get("expr", {}), errors, f"{context}.expr")

    elif t == "case":
        when_clauses = expr.get("when_clauses", [])
        if not when_clauses:
            errors.append(f"{context}: case.when_clauses must not be empty")
        operand = expr.get("operand")
        if operand is not None:
            _validate_expr(operand, errors, f"{context}.operand")
        for i, clause in enumerate(when_clauses):
            _validate_expr(clause.get("when", {}), errors, f"{context}.when_clauses[{i}].when")
            _validate_expr(clause.get("then", {}), errors, f"{context}.when_clauses[{i}].then")
        else_expr = expr.get("else")
        if else_expr is not None:
            _validate_expr(else_expr, errors, f"{context}.else")

    else:
        errors.append(f"{context}: unknown expression type '{t}'")


def _exprs_in_transformation(tr: dict) -> list[tuple[dict, str]]:
    """Return all (expr_dict, context_label) pairs inside a transformation."""
    tr_type = tr.get("type", "")
    tr_id   = tr.get("id", "?")
    prefix  = f"{tr_type} '{tr_id}'"
    result: list[tuple[dict, str]] = []

    if tr_type == "select":
        for i, col in enumerate(tr.get("columns", [])):
            result.append((col.get("expr", {}), f"{prefix} col[{i}] expr"))

    elif tr_type == "filter":
        result.append((tr.get("condition", {}), f"{prefix} condition"))

    elif tr_type == "join":
        result.append((tr.get("condition", {}), f"{prefix} condition"))
        for i, col in enumerate(tr.get("columns", [])):
            result.append((col.get("expr", {}), f"{prefix} col[{i}] expr"))

    elif tr_type == "aggregate":
        for i, g in enumerate(tr.get("group_by", [])):
            result.append((g, f"{prefix} group_by[{i}]"))
        for i, col in enumerate(tr.get("aggregations", [])):
            result.append((col.get("expr", {}), f"{prefix} agg[{i}] expr"))

    elif tr_type == "compute_column":
        result.append((tr.get("column", {}).get("expr", {}), f"{prefix} column.expr"))

    return result


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
            if dep in successors:
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
    return set()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_model(model: EtlModel) -> list[str]:
    errors: list[str] = []

    source_ids = {s["id"] for s in model.sources}
    transformation_ids = {t["id"] for t in model.transformations}
    all_relation_ids = source_ids | transformation_ids

    # Check 0: generate_series source fields
    for src in model.sources:
        if src.get("type") == "generate_series":
            sid = src.get("id", "?")
            if not isinstance(src.get("start"), int):
                errors.append(
                    f"generate_series source '{sid}': 'start' must be an integer"
                )
            if not src.get("alias"):
                errors.append(
                    f"generate_series source '{sid}': 'alias' must not be empty"
                )
            end_expr = src.get("end_expr", {})
            if not end_expr:
                errors.append(
                    f"generate_series source '{sid}': 'end_expr' must not be empty"
                )
            else:
                _validate_expr(end_expr, errors, f"generate_series '{sid}' end_expr")

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
        return errors

    # Check 5 & 6: column ids unique and non-empty
    col_ids: list[str] = []
    for tr in model.transformations:
        tr_type = tr.get("type", "")
        if tr_type == "select":
            for col in tr.get("columns", []):
                col_ids.append(col.get("id", ""))
        elif tr_type == "join":
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
                if expr.get("type") == "column_ref":
                    alias = expr.get("table_alias", "")
                    name = expr.get("column_name", "")
                    col_sql = f"{alias}.{name}" if alias else name
                    if col_sql not in group_by_col_refs:
                        errors.append(
                            f"AGGREGATE '{tr_id}': column '{col.get('alias', '')}' uses bare "
                            f"ColumnRef '{col_sql}' that is not in group_by and not inside a function"
                        )

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

    # Check 13: ORDER BY scope
    if model.final_relation_id in all_relation_ids:
        final_aliases = _output_aliases_for(model.final_relation_id, model)
        if final_aliases:
            for ob in model.order_by:
                expr = ob.get("expr", {})
                if expr.get("type") == "column_ref":
                    col_name = expr.get("column_name", "")
                    if col_name not in final_aliases:
                        errors.append(
                            f"ORDER BY references column '{col_name}' "
                            f"not available in final relation scope"
                        )

    # Check 14: expression-level validation (recursive)
    for tr in model.transformations:
        for expr, ctx in _exprs_in_transformation(tr):
            _validate_expr(expr, errors, ctx)

    for i, ob in enumerate(model.order_by):
        _validate_expr(ob.get("expr", {}), errors, f"order_by[{i}]")

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

    # Step 3 — Topological sort
    execution_order = _kahn_sort(graph)

    # Step 4 — Initialize runtime structures
    sql_map: dict[str, str] = {}
    cte_map: dict[str, str] = {}

    # Step 5 — Process relations in topological order
    for rid in execution_order:
        node = relations[rid]

        if node["type"] == "source":
            source = node["source"]
            src_type = source.get("type", "")
            alias_part = f" {source['alias']}" if source.get("alias") else ""

            if src_type == "cte":
                cte_map[source["name"]] = source["sql"]
                sql_map[rid] = f"(SELECT * FROM {source['name']})"

            elif src_type == "generate_series":
                col = source.get("alias", "n")
                start = source.get("start", 1)
                end_sql = expr_to_sql(source["end_expr"])
                cte_name = f"_gs_{rid[:8]}"
                # Inline WITH RECURSIVE — requires SQLite ≥ 3.35
                sql_map[rid] = (
                    f"(WITH RECURSIVE {cte_name}({col}) AS ("
                    f"SELECT {start} "
                    f"UNION ALL "
                    f"SELECT {col} + 1 FROM {cte_name} WHERE {col} < {end_sql}"
                    f") SELECT {col} FROM {cte_name})"
                )

            else:
                sql_map[rid] = f"(SELECT * FROM {source['name']}{alias_part})"

        elif node["type"] == "select":
            tr = node["transformation"]
            base_sql = sql_map[tr["inputs"][0]]
            cols = ", ".join(
                f"{expr_to_sql(col['expr'])} AS {col['alias']}"
                for col in tr.get("columns", [])
            )
            sql_map[rid] = f"(SELECT {cols} FROM {base_sql})"

        elif node["type"] == "filter":
            tr = node["transformation"]
            base_sql = sql_map[tr["inputs"][0]]
            condition = expr_to_sql(tr["condition"])
            if tr["mode"] == "where":
                sql_map[rid] = f"(SELECT * FROM {base_sql} WHERE {condition})"
            else:
                sql_map[rid] = f"(SELECT * FROM {base_sql} HAVING {condition})"

        elif node["type"] == "join":
            tr = node["transformation"]
            left_rid = tr["left_input"]
            left_node = relations[left_rid]
            # Table sources wrap their alias inside the subquery, making it invisible
            # at the join level.  Use the table name + alias directly so that
            # column_refs like "il"."col" resolve correctly in the ON condition.
            if left_node["type"] == "source" and left_node["source"].get("type") == "table":
                src = left_node["source"]
                src_alias = src.get("alias", "")
                left_sql = f"{src['name']} {src_alias}" if src_alias else src["name"]
            else:
                left_sql = sql_map[left_rid]
            right_node = relations[tr["right_source"]]
            right_source = right_node["source"]
            if right_source.get("type") == "table":
                right_sql = f"(SELECT * FROM {right_source['name']})"
            else:
                right_sql = sql_map[tr["right_source"]]
            join_type = tr.get("join_type", "inner").upper()
            alias_part = f" AS {tr['alias']}" if tr.get("alias") else ""
            condition = expr_to_sql(tr["condition"])
            join_columns = tr.get("columns")
            if join_columns:
                cols_sql = ", ".join(
                    f"{expr_to_sql(col['expr'])} AS {col['alias']}"
                    for col in join_columns
                )
                sql_map[rid] = (
                    f"(SELECT {cols_sql} FROM {left_sql} "
                    f"{join_type} JOIN {right_sql}{alias_part} ON {condition})"
                )
            else:
                sql_map[rid] = (
                    f"(SELECT * FROM {left_sql} "
                    f"{join_type} JOIN {right_sql}{alias_part} ON {condition})"
                )

        elif node["type"] == "aggregate":
            tr = node["transformation"]
            base_sql = sql_map[tr["inputs"][0]]
            group_exprs = [expr_to_sql(g) for g in tr.get("group_by", [])]
            agg_exprs = [
                f"{expr_to_sql(col['expr'])} AS {col['alias']}"
                for col in tr.get("aggregations", [])
            ]
            select_sql  = ", ".join(group_exprs + agg_exprs)
            group_by_sql = ", ".join(group_exprs)
            sql_map[rid] = (
                f"(SELECT {select_sql} FROM {base_sql} GROUP BY {group_by_sql})"
            )

        elif node["type"] == "compute_column":
            tr = node["transformation"]
            base_sql = sql_map[tr["inputs"][0]]
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

    return final_sql
