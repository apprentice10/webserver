---
# engines/sheet_v1/backend/routes_revisions.py

**Description:** Revision system endpoints for Sheet V1 — create/list/delete revisions and revert to a previous snapshot.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 24–28 | `RevisionCreate` | Local Pydantic model for revision creation payload |
| 33–53 | `_snapshot_all_tools(conn, revision_id)` | Serialises all tool rows/columns into `_revision_snapshots` table for the given revision |
| 54–62 | `_latest_revision(conn)` | Returns most recent revision row from DB |
| 67–75 | `GET /revisions` | Lists all revisions for the project |
| 76–95 | `POST /revision` | Creates a new revision with a full snapshot |
| 96–131 | `DELETE /revision/{number}` | Deletes a revision and its snapshots |
| 132–159 | `GET /revision/{number}/tool/{tool_slug}` | Returns snapshot data for a specific tool in a specific revision |
| 160–end | `POST /revision/{number}/revert` | Restores all tools to their snapshot state at the given revision |

## Decisions

- **`RevisionCreate` is local**: this model is only used here so it lives in this file rather than the shared `schemas.py` to avoid polluting it.
- **Snapshot-on-create**: the full serialised state of all tools is written at revision creation time. No lazy/diff-based storage — simpler to revert.
