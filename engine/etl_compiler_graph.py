from __future__ import annotations

from collections import deque

from .etl_compiler_expr import EtlCompilationError
from .etl_model import EtlModel


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
