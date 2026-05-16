"""
engine/sql_to_model.py
SQL → EtlModel best-effort converter for migrating old SQL-based ETL to model-first IR.

Supported patterns:
- WITH ... AS (...) CTEs → CTE sources
- FROM table [alias] → table source
- [LEFT|RIGHT|INNER|FULL] JOIN table [alias] ON condition → join transformation
- SELECT col_list → select transformation
- WHERE condition → filter transformation (mode=where)
- GROUP BY exprs → aggregate transformation (columns re-used as aggregations)
- HAVING condition → filter transformation (mode=having)
- ORDER BY → order_by entries

Full expression grammar (no expr_sql fallback):
- column_ref, literal, function, binary_op, logical (and/or), unary_op (not)
- is_null, is_not_null, case
- || chains → CONCAT_WS (with separator detection)
- = NULL / != NULL → is_null / is_not_null (auto-fixed)
"""

from __future__ import annotations
import re
import uuid

from dashboard.sql_to_model_expr import (
    _EXPR_KEYWORDS,
    _tokenize_expr,
    _ExprParser,
    _try_rewrite_split_part,
    _parse_expr,
)
from dashboard.sql_to_model_lexer import (
    _mask_strings,
    _unmask,
    _comma_split,
    _find_clauses,
)


def _gen_id() -> str:
    return "x" + uuid.uuid4().hex[:8]


# ─────────────────────────────────────────────────────────────────────────────
# generate_series CTE detection
# ─────────────────────────────────────────────────────────────────────────────

# Matches: SELECT <int> UNION ALL SELECT <alias> + 1 FROM <anything> WHERE <alias> < <end>
_GEN_SERIES_RECURSIVE_RE = re.compile(
    r"^\s*SELECT\s+(\d+)\s+UNION\s+ALL\s+SELECT\s+(\w+)\s*\+\s*1\s+FROM\s+\w+"
    r"\s+WHERE\s+\2\s*<\s*(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
# Matches: SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 ...
_GEN_SERIES_UNION_RE = re.compile(
    r"^\s*SELECT\s+\d+(?:\s+UNION\s+ALL\s+SELECT\s+\d+)+\s*$",
    re.IGNORECASE,
)


def _detect_generate_series_cte(
    cte_name: str, cte_sql: str, str_tbl: dict
) -> "dict | None":
    """
    Detect number-generator CTE patterns and return a generate_series source dict.
    Returns None if the CTE is not a recognized generator pattern.
    """
    sql = cte_sql.strip()

    # Pattern A — recursive generator: SELECT 1 UNION ALL SELECT n+1 FROM cte WHERE n < X
    m = _GEN_SERIES_RECURSIVE_RE.match(sql)
    if m:
        start = int(m.group(1))
        end_text = m.group(3).strip()
        try:
            end_expr = _parse_expr(end_text, str_tbl)
        except (ValueError, Exception):
            return None
        if not end_expr:
            return None
        return {
            "id": _gen_id(),
            "type": "generate_series",
            "name": "_generate_series",
            "alias": cte_name,
            "sql": "",
            "start": start,
            "end_expr": end_expr,
        }

    # Pattern B — UNION ALL of consecutive integer literals: SELECT 1 UNION ALL SELECT 2 ...
    m2 = _GEN_SERIES_UNION_RE.match(sql)
    if m2:
        nums = list(map(int, re.findall(r"\d+", sql)))
        if len(nums) >= 2 and all(nums[i] + 1 == nums[i + 1] for i in range(len(nums) - 1)):
            return {
                "id": _gen_id(),
                "type": "generate_series",
                "name": "_generate_series",
                "alias": cte_name,
                "sql": "",
                "start": nums[0],
                "end_expr": {"type": "literal", "value": nums[-1]},
            }

    return None


# ─────────────────────────────────────────────────────────────────────────────
# CTE extraction
# ─────────────────────────────────────────────────────────────────────────────

def _extract_ctes(sql: str, str_tbl: dict | None = None) -> tuple[list[dict], str]:
    if str_tbl is None:
        str_tbl = {}
    sql = sql.strip()
    if not re.match(r"\bWITH\b", sql, re.IGNORECASE):
        return [], sql
    m = re.match(r"\bWITH\b\s*(?:RECURSIVE\s+)?", sql, re.IGNORECASE)
    pos = m.end()
    ctes: list[dict] = []
    while pos < len(sql):
        nm = re.match(
            r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\)\s*)?AS\s*\(",
            sql[pos:], re.IGNORECASE,
        )
        if not nm:
            break
        cte_name = nm.group(1)
        paren_start = pos + nm.end() - 1
        depth = 0
        j = paren_start
        while j < len(sql):
            if sql[j] == "(": depth += 1
            elif sql[j] == ")":
                depth -= 1
                if depth == 0: break
            j += 1
        cte_sql = sql[paren_start + 1:j].strip()
        gs = _detect_generate_series_cte(cte_name, cte_sql, str_tbl)
        if gs:
            ctes.append(gs)
        else:
            ctes.append({
                "id": _gen_id(), "type": "cte",
                "name": cte_name, "alias": cte_name, "sql": cte_sql,
            })
        pos = j + 1
        sep = re.match(r"\s*,\s*", sql[pos:])
        if sep:
            pos += sep.end()
        else:
            break
    return ctes, sql[pos:].strip()


# ─────────────────────────────────────────────────────────────────────────────
# Identifier helpers
# ─────────────────────────────────────────────────────────────────────────────

def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] in ('"', '`') and s[-1] == s[0]:
        return s[1:-1]
    return s


def _table_ref(text: str) -> tuple[str, str]:
    text = text.strip()
    m = re.match(r'^(\S+)\s+AS\s+(\S+)\s*$', text, re.IGNORECASE)
    if m:
        return _unquote(m.group(1)), _unquote(m.group(2))
    m2 = re.match(r'^([A-Za-z_"][A-Za-z0-9_"]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$', text, re.IGNORECASE)
    if m2:
        return _unquote(m2.group(1)), m2.group(2)
    m3 = re.match(r'^([A-Za-z_"][A-Za-z0-9_"]*)\s*$', text, re.IGNORECASE)
    if m3:
        name = _unquote(m3.group(1))
        return name, name
    parts = text.split()
    return _unquote(parts[0]), parts[-1]


# ─────────────────────────────────────────────────────────────────────────────
# SELECT column item parser
# ─────────────────────────────────────────────────────────────────────────────

_AS_ALIAS_RE = re.compile(r'\s+AS\s+([A-Za-z_"][A-Za-z0-9_"]*)\s*$', re.IGNORECASE)


def _parse_col_item(item: str, str_tbl: dict) -> dict:
    """Parse one SELECT list item into a Column dict {id, alias, expr}."""
    item = item.strip()
    alias = None
    expr_text = item

    m = _AS_ALIAS_RE.search(item)
    if m:
        alias = _unquote(m.group(1))
        expr_text = item[:m.start()].strip()
    else:
        parts = item.rsplit(None, 1)
        if len(parts) == 2 and re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', parts[1]):
            if "." in parts[0] or "(" in parts[0]:
                alias = parts[1]
                expr_text = parts[0].strip()

    expr = _parse_expr(expr_text, str_tbl)

    if alias is None:
        if expr.get("type") == "column_ref":
            alias = expr["column_name"]
        else:
            alias = re.sub(r'\W+', '_', _unmask(expr_text, str_tbl))[:24].strip("_") or "col"

    return {"id": _gen_id(), "alias": alias, "expr": expr}


# ─────────────────────────────────────────────────────────────────────────────
# Join type helper
# ─────────────────────────────────────────────────────────────────────────────

def _join_type(kw_text: str) -> str:
    up = kw_text.upper()
    if "LEFT" in up:   return "LEFT"
    if "RIGHT" in up:  return "RIGHT"
    if "FULL" in up:   return "FULL"
    if "CROSS" in up:  return "CROSS"
    return "INNER"


# ─────────────────────────────────────────────────────────────────────────────
# Main converter
# ─────────────────────────────────────────────────────────────────────────────

def sql_to_model(sql: str) -> dict:
    """
    Convert a SQL SELECT statement to an EtlModel dict.
    Raises ValueError on structural parse failure or unparseable expressions.
    All output conforms to the EtlModel v1 grammar (no expr_sql nodes).
    """
    sql = sql.strip().rstrip(";")
    if not sql:
        raise ValueError("Empty SQL")

    masked, str_tbl = _mask_strings(sql)
    cte_sources, main_sql = _extract_ctes(masked, str_tbl)
    clauses = _find_clauses(main_sql)

    tags = [tag for tag, _, _ in clauses]
    if "SELECT" not in tags:
        raise ValueError("No SELECT clause found")
    if "FROM" not in tags:
        raise ValueError("No FROM clause found")

    clause_dict: dict = {}
    join_queue: list[tuple[str, str]] = []
    on_queue: list[str] = []

    for tag, kw_text, content in clauses:
        if tag in ("JOIN", "TYPED_JOIN"):
            join_queue.append((_join_type(kw_text), content))
        elif tag == "ON":
            on_queue.append(content)
        elif tag == "LIMIT":
            pass
        else:
            clause_dict[tag] = content

    # ── Sources ──────────────────────────────────────────────────────────────
    sources: list[dict] = list(cte_sources)
    cte_by_name = {c["name"]: c["id"] for c in cte_sources}

    from_name, from_alias = _table_ref(clause_dict["FROM"])
    if from_name in cte_by_name:
        from_id = cte_by_name[from_name]
        for s in sources:
            if s["id"] == from_id:
                s["alias"] = from_alias
    else:
        from_id = _gen_id()
        sources.append({"id": from_id, "type": "table", "name": from_name, "alias": from_alias, "sql": ""})

    # ── Transformations ───────────────────────────────────────────────────────
    transformations: list[dict] = []
    current_rel = from_id

    # JOINs
    for ji, (jtype, jtable_text) in enumerate(join_queue):
        right_name, right_alias = _table_ref(jtable_text)
        if right_name in cte_by_name:
            right_id = cte_by_name[right_name]
        else:
            right_id = _gen_id()
            sources.append({"id": right_id, "type": "table", "name": right_name, "alias": right_alias, "sql": ""})
        on_text = on_queue[ji] if ji < len(on_queue) else ""
        join_id = _gen_id()
        transformations.append({
            "id": join_id,
            "type": "join",
            "inputs": [current_rel, right_id],
            "join_type": jtype,
            "left_input": current_rel,
            "right_source": right_id,
            "alias": right_alias,
            "condition": _parse_expr(on_text, str_tbl),
        })
        current_rel = join_id

    # WHERE → filter before SELECT/AGGREGATE
    where_text = clause_dict.get("WHERE", "").strip()
    if where_text:
        filter_id = _gen_id()
        transformations.append({
            "id": filter_id,
            "type": "filter",
            "inputs": [current_rel],
            "condition": _parse_expr(where_text, str_tbl),
            "mode": "where",
        })
        current_rel = filter_id

    # SELECT column list
    sel_text = clause_dict.get("SELECT", "").strip()
    if re.match(r"DISTINCT\b", sel_text, re.IGNORECASE):
        sel_text = sel_text[8:].strip()
    columns = [_parse_col_item(item, str_tbl) for item in _comma_split(sel_text)]

    # GROUP BY → aggregate
    group_text = clause_dict.get("GROUP_BY", "").strip()
    having_text = clause_dict.get("HAVING", "").strip()
    final_rel: str

    if group_text:
        group_exprs = [_parse_expr(g, str_tbl) for g in _comma_split(group_text)]
        agg_id = _gen_id()
        transformations.append({
            "id": agg_id,
            "type": "aggregate",
            "inputs": [current_rel],
            "group_by": group_exprs,
            "aggregations": columns,
        })
        current_rel = agg_id
        final_rel = agg_id
        if having_text:
            hav_id = _gen_id()
            transformations.append({
                "id": hav_id,
                "type": "filter",
                "inputs": [current_rel],
                "condition": _parse_expr(having_text, str_tbl),
                "mode": "having",
            })
            current_rel = hav_id
            final_rel = hav_id
    else:
        sel_id = _gen_id()
        transformations.append({
            "id": sel_id,
            "type": "select",
            "inputs": [current_rel],
            "columns": columns,
        })
        final_rel = sel_id

    # ORDER BY
    order_by: list[dict] = []
    order_text = clause_dict.get("ORDER_BY", "").strip()
    if order_text:
        for item in _comma_split(order_text):
            item = item.strip()
            direction = "asc"
            if re.search(r"\bDESC\b", item, re.IGNORECASE):
                direction = "desc"
                item = re.sub(r"\s*\bDESC\b\s*$", "", item, flags=re.IGNORECASE).strip()
            else:
                item = re.sub(r"\s*\bASC\b\s*$", "", item, flags=re.IGNORECASE).strip()
            order_by.append({"expr": _parse_expr(item, str_tbl), "direction": direction})

    return {
        "sources": sources,
        "transformations": transformations,
        "final_relation_id": final_rel,
        "order_by": order_by,
        "meta": {"schema_version": 1},
    }
