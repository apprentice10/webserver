# engine/routes_revisions.py

**Description:** Revision CRUD endpoints — list, create, delete latest, revert to snapshot, read frozen snapshot data.

**Index:**

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–20 | imports / router | APIRouter at `/api/project`, `RevisionCreate` schema |
| 30–43 | `_snapshot_all_tools` | Dumps columns + rows for every tool into `_revision_snapshots` for a given `revision_id` |
| 45–50 | `_latest_revision` | Returns the highest-numbered revision row; raises 500 if table is empty |
| 54–60 | `GET /revisions` | Lists all revisions + current (latest) number |
| 62–75 | `POST /revision` | Snapshots current state under latest revision id, then inserts new revision N+1 |
| 77–103 | `DELETE /revision/{number}` | Merges latest revision into previous: retags live rows + audit, deletes snapshots + revision row. Only latest revision can be deleted |
| 105–130 | `GET /revision/{number}/tool/{tool_slug}` | Returns `{ columns, rows }` from the frozen snapshot for that revision + tool |
| 132–189 | `POST /revision/{number}/revert` | Safety-backs up the DB file, restores columns + rows from target snapshot, deletes all revisions and snapshots beyond target |

**Decisions:**

- `_snapshot_all_tools` is called with the **current** (pre-create) revision id — the snapshot represents "what rev N looked like" so reverting to N restores from it.
- Delete is restricted to the latest revision only (Q-D8). Attempting to delete an older revision is a 400.
- Revert refuses if the target IS the current revision (no-op guard) and if no snapshot exists for the target (corrupt/missing data guard).
- Safety backup is written to `db_path.parent` (same dir as the project DB) with filename `{stem}_discarded_rev{latest}_{YYYYMMDD_HHMMSS}.db`. If the file already exists it is NOT overwritten (see Q-D9).
- Revert restores only tools present in the snapshot; tools added after the target revision retain their current state.
- `_columns` rows are restored with explicit field list (not `INSERT OR REPLACE *`) to avoid surprises from future schema additions.
