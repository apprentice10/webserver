# static/engine/js/history/history-api.js

**Description:** Thin wrappers over `ApiClient.getAudit` and `ApiClient.rollbackCell`. Isolates the history subsystem from `api.js` so that other history modules never call `ApiClient` directly.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 3–5 | `getAudit(params)` | Delegates to `ApiClient.getAudit(params)`; params shape: `{ rowTag?, rowTags?, colSlug?, colSlugs?, limit? }` |
| 7–9 | `rollbackCell(rowId, colSlug, entryId)` | Delegates to `ApiClient.rollbackCell(rowId, colSlug, entryId)`; returns updated row object |

## Decisions

- **No param validation here**: `ApiClient` already handles URL construction and HTTP errors. Adding a second layer would be redundant noise.
- **`col` vs `colSlug`**: `ApiClient.rollbackCell` names the second arg `col` internally, but the public contract across the history subsystem uses `colSlug` consistently. The rename happens at this boundary.
- **No subsystem deps**: this module depends only on `api.js` (loaded before it). See load order in `history/README.md`.
