# MTO Revision — Full Feature Set

**Status: BLOCKED — requires Group G (Shared Grid Toolkit) to complete first.**
See `_context/project/plan_group_g_shared_grid.md`.

---

## Goal

Revise the MTO engine to its full intended feature set: a multipurpose typical assembly and material take-off tool. Each typical has a name, description, image, a materials table (with full grid features via Group G), and a utilities table (ETL-fed). Includes a material catalog for auto-fill and sync, tag annotation on images, import/export between project databases, and Excel export with tag positions.

---

## What Already Exists (do not rebuild)

- Typical tab bar, page navigation, typical CRUD (create/rename/delete)
- Utilities table — read-only, fed by ETL (`mto_utilities` table, filtered by `typical_name`)
- Materials table — basic custom table with TAG, REV, LOG, part_description, size, material, uom, quantity, total, drag-reorder (`mto_materials` table)
- Image upload per typical — SVG (pan/zoom), PDF (native viewer), DXF (download-only) (`mto_images` table, BLOB storage)
- Tag annotation — drag from materials table → drop on SVG image → two-click label+arrow placement, stored as 0–1 viewport fractions (`mto_tag_placements` table)
- Import typical from external `.db` file (materials + image + placements)
- Export typical to external `.db` file
- Excel export (basic)
- ETL for utilities (one ETL instance, writes to `mto_utilities`)

---

## What Needs to Be Built / Changed

### M1 — Full grid for materials table (depends on Group G)
Replace the current custom `mto_materials.js` table with the shared grid (Group G step G6). The materials table must expose the full grid experience: FLAGS, LOG panel, REV, sort, filter, column resize, copy/paste, undo/redo, find-replace, fill handle.
Backend must implement the grid-api v1 contract for `mto_materials` scoped by `typical_id`.

### M2 — Add `note` column to `mto_materials`
Current schema is missing a `note` field. Add it as the last user-editable column.
**Schema migration required** — bump SCHEMA_VERSION in `project_db.py`.

### M3 — Material catalog
A shared catalog table (`mto_material_catalog`) stored in the project DB. Columns: `tag` (PK), `part_description`, `size`, `uom`.

**Sync rules (agreed in grill-me session, 2026-05-18):**
- User adds a new row in the materials table with a TAG → if TAG exists in catalog: auto-fill `part_description`, `size`, `uom`. If TAG is new → add it to the catalog on save.
- User edits `part_description`, `size`, or `uom` on an existing materials row → update the catalog entry for that TAG.
- User changes a `tag` cell in the materials table → re-import `part_description`, `size`, `uom` from catalog for the new TAG (if it exists).
- Catalog and materials table stay in sync at all times.

**Autocomplete:** While the user types in a TAG cell in the materials table, suggest matching TAGs from the catalog. On selection, auto-fill the other catalog columns.

**Open decision (resolve in next grill-me before building M3):**
Where does the catalog live? Options:
  - A: `mto_material_catalog` table inside the current project DB (simple, project-specific)
  - B: A separate shared `.db` file (cross-project catalog, user links it in settings)
  - The export-to-catalog workflow described by the user ("export this typical into another project database used as a catalog") implies a separate file, but the autocomplete-while-typing implies in-project storage. Clarify before building.

### M4 — Two ETL instances (utilities + materials source)
Currently only one ETL is wired (for utilities). The user described a second ETL that could import material data from the project database into the materials table (e.g. load a template of standard parts). This is separate from the catalog sync in M3.
**Open decision (resolve in next grill-me):** Is this second ETL a "seed/load once" operation, or does it re-run and overwrite materials like the utilities ETL re-runs and overwrites `mto_utilities`? If overwrite, it conflicts with manual edits and catalog sync. Needs clarification.

### M5 — `total` column via ETL or live compute
Current implementation: `total = quantity × utility_count` computed on every read in the backend. The user mentioned total might be computed in the ETL. Current approach already works. Confirm whether to keep the live-compute approach or change it once M1 (grid) and M3 (catalog) are in place.

### M6 — Excel export with tag positions
The existing Excel export (`routes_export_excel.py`) should include placement coordinates so that tag labels appear in the correct position in the exported sheet. Possibly as a separate export mode ("Export with annotations"). Scope TBD.

### M7 — Typical description field
The user mentioned each typical has a "description". Current `mto_typicals` schema may not have a `description` column. Verify and add if missing.

---

## Schema Changes Summary

| Table | Change |
|-------|--------|
| `mto_materials` | Add `note TEXT` column |
| `mto_typicals` | Verify/add `description TEXT` column |
| `mto_material_catalog` | New table: `tag TEXT PK, part_description TEXT, size TEXT, uom TEXT` |

---

## Decisions (locked from grill-me 2026-05-18)

- **Grid approach:** Use shared grid from Group G (not a custom table, not a patch). This was the explicit decision made in the grill-me session.
- **TAG = row id string:** TAG is auto-assigned by the backend as a string of the row's integer ID. It is the stable drag-source identifier for image annotation. Preserved verbatim on import. Do not change this.
- **`total` is not stored:** Computed on every read as `quantity × utility_count`. This already works; do not break it during M1 grid migration.
- **Import: idempotent re-import:** Importing a typical that already exists replaces its materials/image/placements but preserves the typical row and ETL-derived data.
- **Coordinates as 0–1 fractions:** Placement coordinates stored as viewport fractions. Scale-safe on resize and re-upload.

---

## Open Decisions (must resolve before building the relevant step)

1. **Catalog location (M3):** Project DB table vs separate shared `.db` file.
2. **Second ETL scope (M4):** Seed-once vs live-overwrite. Does it conflict with manual edits?
3. **Excel export with annotations (M6):** What does the output look like? Tag label in a cell? As a drawing overlay?

---

## Risks

- **Grid migration (M1):** `mto_materials` lacks `__id`, `__position`, `__log`, `__created_at` system columns. Grid contract (Group G step G2) must clarify which are required. May need a schema migration.
- **Catalog sync race (M3):** If two users edit the same project simultaneously, catalog writes may conflict. Single-user SQLite assumption is safe for now; document the constraint.
- **Two ETLs (M4):** The ETL system today runs one ETL per tool. Running two ETLs on the same MTO tool instance needs a routing mechanism (which ETL target?). Scope this in the M4 grill-me.
