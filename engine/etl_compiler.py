from __future__ import annotations

from typing import Any

from .etl_model import model_from_dict
from .etl_compiler_expr import EtlValidationError, EtlCompilationError, expr_to_sql
from .etl_compiler_graph import _kahn_sort
from .etl_compiler_validate import validate_model


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
