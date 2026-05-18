# MTO V1 — ETL Template Reference

Knowledge captured from the test_test1.db project and the tmp_MTO.json template session.

---

## Table Schemas (as observed in project DBs)

### `mto_utilities`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK |
| `tool_id` | INTEGER | FK → `_tools.id` |
| `tag` | TEXT | **Required ETL output column** |
| `typical_name` | TEXT | **Required ETL output column** |

Extra columns in the ETL output (beyond `tag` / `typical_name`) are accepted and stored. Discovered at query time via `PRAGMA table_info`.

### `mto_materials`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PK |
| `typical_id` | INTEGER | FK → `mto_typicals.id` |
| `tag` | TEXT | |
| `rev` | INTEGER | |
| `log` | TEXT | |
| `part_description` | TEXT | |
| `size` | TEXT | |
| `material` | TEXT | |
| `uom` | TEXT | |
| `quantity` | REAL | |
| `position` | INTEGER | |

Materials are **never written by ETL** — they are added manually per typical. The ETL only owns `mto_utilities`.

---

## `std_cable` Schema (source table for MTO ETL)

| Column | Type | Notes |
|--------|------|-------|
| `__id` | INTEGER | System — skip in ETL |
| `__position` | INTEGER | System — skip in ETL |
| `__log` | TEXT | System — skip in ETL |
| `__created_at` | TEXT | System — skip in ETL |
| `tag` | TEXT | Instrument identifier → maps to `mto_utilities.tag` |
| `rev` | TEXT | |
| `certificato` | TEXT | |
| `alimentazione` | TEXT | |
| `cavo` | TEXT | |
| `note` | TEXT | |
| `tipico` | TEXT | Typical name → maps to `mto_utilities.typical_name` |

Filter condition for MTO: `tipico IS NOT NULL AND tipico != ''`

---

## ETL Template Format (`tmp_*.json`)

These files are serialised ETL models. They live in the project root alongside other `tmp_*.json` files and are loaded via the ETL editor UI.

```
{
  "sources": [ { "id", "type": "table", "name": <table>, "alias", "sql": "" } ],
  "transformations": [
    { "id", "type": "filter", "inputs": [prev_id], "condition": {...}, "mode": "where" },
    { "id", "type": "select", "inputs": [prev_id], "columns": [ { "id", "alias", "expr" } ] }
  ],
  "final_relation_id": <last transform id>,
  "order_by": [ { "expr": {...}, "direction": "asc"|"desc" } ],
  "meta": { "schema_version": 1 }
}
```

**ID format:** `x` + 8 hex characters (e.g. `xa1b2c3d4`). Must be unique within the file.

**Expression types used in columns/conditions:**

| Type | Fields | Example use |
|------|--------|-------------|
| `column_ref` | `table_alias`, `column_name` | Pass-through column |
| `literal` | `value` (null or string) | Null placeholder column |
| `is_not_null` | `expr` | Filter condition |
| `function` | `name`, `args` | TRIM, COALESCE, CONCAT_WS |
| `logical` | `op` (and/or), `args` | Compound filter |

---

## `tmp_MTO.json` — What It Does

Saved at project root. Populates `mto_utilities` from `std_cable` for a project that uses the `tipico` column as typical assignment.

**Pipeline:**
1. Source: `std_cable`
2. Filter: `tipico IS NOT NULL`
3. Select: `tag`, `typical_name` (= tipico), `certificato`, `alimentazione`, `cavo`, `note`
4. Order by: `typical_name ASC`

**After apply:** `mto_typicals` rows are auto-created for each distinct `typical_name`. Materials for each typical remain empty until filled manually.

---

## How to Use an ETL Template in MTO

1. Open the project in the web UI.
2. Open the MTO tool.
3. Open the ETL editor (toolbar button).
4. Load template → select `tmp_MTO.json`.
5. Preview to verify the 14 rows (or current count).
6. Apply — writes to `mto_utilities`, auto-creates `mto_typicals`.
