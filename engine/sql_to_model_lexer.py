"""
engine/sql_to_model_lexer.py
SQL string masking, depth-0 comma splitting, and clause extraction utilities.
Extracted from sql_to_model.py (P1-004c) — zero dependencies on the rest of that module.
"""

from __future__ import annotations
import re


# ─────────────────────────────────────────────────────────────────────────────
# String literal masking
# ─────────────────────────────────────────────────────────────────────────────

def _mask_strings(sql: str) -> tuple[str, dict]:
    """Replace SQL string literals with \x00Sn$ placeholders."""
    tbl: dict = {}
    idx, out, i = 0, [], 0
    while i < len(sql):
        if sql[i] == "'":
            j, buf = i + 1, [sql[i]]
            while j < len(sql):
                if sql[j] == "'" and j + 1 < len(sql) and sql[j + 1] == "'":
                    buf += ["'", "'"]
                    j += 2
                elif sql[j] == "'":
                    buf.append("'")
                    j += 1
                    break
                else:
                    buf.append(sql[j])
                    j += 1
            key = f"\x00S{idx}$"
            tbl[key] = "".join(buf)
            out.append(key)
            idx += 1
            i = j
        else:
            out.append(sql[i])
            i += 1
    return "".join(out), tbl


def _unmask(s: str, tbl: dict) -> str:
    for k, v in tbl.items():
        s = s.replace(k, v)
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Depth-0 comma split
# ─────────────────────────────────────────────────────────────────────────────

def _comma_split(text: str) -> list[str]:
    parts, depth, buf = [], 0, []
    for c in text:
        if c == "(":
            depth += 1
            buf.append(c)
        elif c == ")":
            depth -= 1
            buf.append(c)
        elif c == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
    if buf:
        parts.append("".join(buf).strip())
    return [p for p in parts if p]


# ─────────────────────────────────────────────────────────────────────────────
# Clause extraction — ordered list of (keyword_tag, keyword_text, content)
# ─────────────────────────────────────────────────────────────────────────────

_CLAUSE_PATTERNS: list[tuple[str, str]] = [
    (r"SELECT\s+DISTINCT\b", "SELECT"),
    (r"SELECT\b", "SELECT"),
    (r"FROM\b", "FROM"),
    (r"(?:LEFT|RIGHT|INNER|FULL)\s+(?:OUTER\s+)?JOIN\b", "TYPED_JOIN"),
    (r"CROSS\s+JOIN\b", "TYPED_JOIN"),
    (r"JOIN\b", "JOIN"),
    (r"ON\b", "ON"),
    (r"WHERE\b", "WHERE"),
    (r"GROUP\s+BY\b", "GROUP_BY"),
    (r"HAVING\b", "HAVING"),
    (r"ORDER\s+BY\b", "ORDER_BY"),
    (r"LIMIT\b", "LIMIT"),
]
_COMPILED_CLAUSES = [(re.compile(pat, re.IGNORECASE), tag) for pat, tag in _CLAUSE_PATTERNS]


def _find_clauses(sql: str) -> list[tuple[str, str, str]]:
    positions: list[tuple[int, int, str, str]] = []
    depth = 0
    i = 0
    while i < len(sql):
        c = sql[i]
        if c == "(":
            depth += 1; i += 1; continue
        if c == ")":
            depth -= 1; i += 1; continue
        if depth == 0:
            matched = False
            for pat, tag in _COMPILED_CLAUSES:
                m = pat.match(sql, i)
                if m:
                    positions.append((i, m.end(), tag, m.group(0)))
                    i = m.end()
                    matched = True
                    break
            if not matched:
                i += 1
        else:
            i += 1

    result: list[tuple[str, str, str]] = []
    for idx, (start, kw_end, tag, kw_text) in enumerate(positions):
        next_start = positions[idx + 1][0] if idx + 1 < len(positions) else len(sql)
        content = sql[kw_end:next_start].strip()
        result.append((tag, kw_text, content))
    return result
