# engine.json

**Description:** Plugin manifest for the MTO engine. Read by `dashboard/catalog.py` at startup to populate the `+new Engine` modal.

## Index

| Field | Purpose |
|-------|---------|
| `slug` | `"mto"` — used as `type_slug` in the `_tools` system table |
| `dashboard_uses` | Declares grid-api v1 and etl-api v1 contracts with the shared dashboard |
| `icon` | Displayed in the engine picker modal |

## Decisions

- Slug is `mto`, folder is `mto_v1` — the folder suffix `_v1` allows future engine versions without breaking existing project DBs that reference the slug.
