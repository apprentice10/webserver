"""
engine/sql_parser.py
--------------------
SQL parsing utilities: table reference extraction, column lineage, alias resolution.
All functions operate on SQL strings; only _resolve_etl_deps requires a DB connection.
"""

import re
import sqlite3

from fastapi import HTTPException

_SQL_KEYWORDS = {"SELECT", "WITH", "LATERAL", "VALUES", "UNNEST"}

# Clause keywords that terminate a SELECT column list at depth 0
_CLAUSE_KW = re.compile(
    r'\b(FROM|WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|INTERSECT|EXCEPT|WINDOW)\b',
    re.IGNORECASE,
)


def clean_sql(sql: str) -> str:
    """Strip string literals, line comments, and block comments for safe regex parsing."""
    s = re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)
    s = re.sub(r"--[^\n]*", " ", s)
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.DOTALL)
    return s


def _output_select_span(text: str) -> tuple[int, int] | None:
    """
    Return (col_list_start, col_list_end) for the output-producing SELECT clause.
    For CTE (WITH …) queries, this is the LAST SELECT at paren depth 0.
    col_list_end is the position of the first depth-0 clause keyword
    (FROM / WHERE / GROUP / …) or closing ')' or end of string.
    Handles SELECT without FROM (e.g. SELECT NULL AS col WHERE 1=0).
    Returns None if no SELECT found.
    """
    n = len(text)
    depth = 0
    sel_starts: list[int] = []

    i = 0
    while i < n:
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif depth == 0 and text[i:i+6].upper() == 'SELECT':
            left_ok = i == 0 or not (text[i-1].isalnum() or text[i-1] == '_')
            after = i + 6
            right_ok = after >= n or not (text[after].isalnum() or text[after] == '_')
            if left_ok and right_ok:
                sel_starts.append(i)
        i += 1

    if not sel_starts:
        return None

    sel_start = sel_starts[-1]
    col_start = sel_start + 6  # skip 'SELECT'
    m = re.match(r'\s+(?:DISTINCT|ALL)?\s*', text[col_start:], re.IGNORECASE)
    if m:
        col_start += m.end()

    depth = 0
    i = col_start
    while i < n:
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            if depth == 0:
                return (col_start, i)
            depth -= 1
        elif depth == 0:
            m = _CLAUSE_KW.match(text, i)
            if m:
                return (col_start, i)
        i += 1

    return (col_start, n)


def extract_table_refs(sql: str) -> list[str]:
    """Return table names referenced in FROM/JOIN clauses (order-preserving, deduplicated)."""
    c = clean_sql(sql)
    tables: list[str] = []
    pattern = r'\b(?:FROM|JOIN)\s+(?:"([^"]+)"|`([^`]+)`|(\w+))'
    for m in re.finditer(pattern, c, re.IGNORECASE):
        name = m.group(1) or m.group(2) or m.group(3)
        if not name or name.upper() in _SQL_KEYWORDS:
            continue
        if name not in tables:
            tables.append(name)
    return tables


def resolve_etl_deps(conn: sqlite3.Connection, sql: str) -> list[str]:
    """Return tool slugs in the DB that are actually referenced by the ETL SQL."""
    refs = extract_table_refs(sql)
    all_slugs = {r[0] for r in conn.execute("SELECT slug FROM _tools").fetchall()}
    return [r for r in refs if r in all_slugs]


def extract_table_aliases(sql: str) -> dict[str, str]:
    """
    Return {alias: table_name} for FROM/JOIN clauses.
    E.g. 'FROM instrument_list il' → {"il": "instrument_list", "instrument_list": "instrument_list"}
    """
    c = clean_sql(sql)
    aliases: dict[str, str] = {}
    pattern = r'\b(?:FROM|JOIN)\s+(?:"([^"]+)"|`([^`]+)`|(\w+))(?:\s+(?:AS\s+)?(?!"|\()(\w+))?'
    for m in re.finditer(pattern, c, re.IGNORECASE):
        tbl = m.group(1) or m.group(2) or m.group(3)
        alias = m.group(4)
        if tbl and tbl.upper() not in _SQL_KEYWORDS:
            aliases[tbl] = tbl
            if alias and alias.upper() not in _SQL_KEYWORDS:
                aliases[alias] = tbl
    return aliases


def _depth0_split(col_list_raw: str) -> list[str]:
    """Split a SELECT column list on commas at depth 0 (ignores commas inside parentheses)."""
    items = []
    depth = 0
    current: list[str] = []
    for ch in col_list_raw:
        if ch == '(':
            depth += 1
            current.append(ch)
        elif ch == ')':
            depth -= 1
            current.append(ch)
        elif ch == ',' and depth == 0:
            items.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
    if current:
        items.append(''.join(current).strip())
    return items


def _col_alias(item: str) -> str | None:
    """Return the output alias for a SELECT item, or None if it cannot be determined."""
    item = item.strip()
    if not item or item == '*':
        return None
    alias_match = re.search(r'\bAS\s+("([^"]+)"|`([^`]+)`|(\w+))\s*$', item, re.IGNORECASE)
    if alias_match:
        return (alias_match.group(2) or alias_match.group(3) or alias_match.group(4)).lower()
    simple = re.match(r'^(\w+)\.(\w+)$', item)
    if simple:
        return simple.group(2).lower()
    bare = re.match(r'^(\w+)$', item)
    if bare:
        return bare.group(1).lower()
    return None


def extract_col_lineage(sql: str) -> dict[str, str]:
    """
    Parse SELECT column list and return {output_col: source_expr}.

    Examples:
      SELECT il.tag, il.service AS svc
        → {"tag": "il.tag", "svc": "il.service"}
      SELECT *, COALESCE(a, b) AS c
        → {"c": "COALESCE(a, b)"}   (* skipped — no usable alias)
    """
    c = clean_sql(sql)
    span = _output_select_span(c)
    if not span:
        return {}

    col_list_raw = c[span[0]:span[1]].strip()
    items = _depth0_split(col_list_raw)

    lineage: dict[str, str] = {}
    for item in items:
        item = item.strip()
        if not item or item == '*':
            continue

        alias_match = re.search(
            r'\bAS\s+("([^"]+)"|`([^`]+)`|(\w+))\s*$',
            item, re.IGNORECASE
        )
        if alias_match:
            alias = alias_match.group(2) or alias_match.group(3) or alias_match.group(4)
            lineage[alias.lower()] = item[:alias_match.start()].strip()
            continue

        simple = re.match(r'^(\w+)\.(\w+)$', item)
        if simple:
            lineage[simple.group(2).lower()] = item
            continue

        bare = re.match(r'^(\w+)$', item)
        if bare:
            lineage[bare.group(1).lower()] = item

    return lineage


def lineage_to_source(expr: str, aliases: dict[str, str]) -> dict:
    """
    Resolve a source expression like 'il.service' to its tool slug.
    aliases: {table_alias: tool_slug}, e.g. {"il": "instrument_list"}
    """
    tbl_match = re.match(r'^(\w+)\.(\w+)$', expr.strip())
    if tbl_match:
        tbl_alias = tbl_match.group(1)
        from_tool = aliases.get(tbl_alias) or tbl_alias
        return {"source_expr": expr, "from_tool": from_tool}
    return {"source_expr": expr, "from_tool": None}


def remove_col_from_sql(sql: str, col_alias: str) -> str:
    """
    Remove a column by alias from the output SELECT clause of sql.
    Raises HTTPException(400) if the column is the only one in the SELECT list.
    Works with CTEs (targets the final SELECT) and SELECT-without-FROM.
    """
    c = clean_sql(sql)
    c_span = _output_select_span(c)
    o_span = _output_select_span(sql)
    if not c_span or not o_span:
        raise HTTPException(status_code=400, detail="Cannot parse SELECT clause")

    cleaned_items = _depth0_split(c[c_span[0]:c_span[1]].strip())
    target = col_alias.lower()
    remove_idx = None
    for i, item in enumerate(cleaned_items):
        if _col_alias(item) == target:
            remove_idx = i
            break

    if remove_idx is None:
        raise HTTPException(status_code=400, detail=f"Column '{col_alias}' not found in SELECT")

    orig_items = _depth0_split(sql[o_span[0]:o_span[1]].strip())

    if len(orig_items) <= 1:
        raise HTTPException(status_code=400,
            detail="Cannot remove the last column from the SELECT clause")

    remaining = [item for i, item in enumerate(orig_items) if i != remove_idx]
    new_col_list = ", ".join(remaining)
    return sql[:o_span[0]] + " " + new_col_list + " " + sql[o_span[1]:]


def rename_col_in_sql(sql: str, old_alias: str, new_alias: str) -> str:
    """
    Rename a SELECT-column alias from old_alias to new_alias in the output SELECT.
    If the item has an explicit AS clause, replaces it; otherwise appends AS new_alias.
    Works with CTEs (targets the final SELECT) and SELECT-without-FROM.
    Raises HTTPException(400) if the column is not found.
    """
    c = clean_sql(sql)
    c_span = _output_select_span(c)
    o_span = _output_select_span(sql)
    if not c_span or not o_span:
        raise HTTPException(status_code=400, detail="Cannot parse SELECT clause")

    cleaned_items = _depth0_split(c[c_span[0]:c_span[1]].strip())
    orig_items    = _depth0_split(sql[o_span[0]:o_span[1]].strip())
    target = old_alias.lower()

    rename_idx = None
    for i, item in enumerate(cleaned_items):
        if _col_alias(item) == target:
            rename_idx = i
            break
    if rename_idx is None:
        raise HTTPException(status_code=400,
            detail=f"Column '{old_alias}' not found in SELECT")

    orig_item = orig_items[rename_idx]
    as_match = re.search(r'\bAS\s+(?:"[^"]+"|`[^`]+`|\w+)\s*$', orig_item, re.IGNORECASE)
    if as_match:
        new_item = orig_item[:as_match.start()] + f"AS {new_alias}"
    else:
        new_item = f"{orig_item} AS {new_alias}"

    new_items = orig_items[:rename_idx] + [new_item] + orig_items[rename_idx + 1:]
    return sql[:o_span[0]] + " " + ", ".join(new_items) + " " + sql[o_span[1]:]
