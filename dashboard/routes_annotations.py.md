---
Updated: 2026-05-19 16:00

# dashboard/routes_annotations.py

**Description:** Annotation HTTP endpoints for Drawing Toolkit. Four routes mounted at `/api/engines/{slug}/tools/{tool_id}/images/{image_id}/annotations/`. All business logic delegated to `dashboard/annotations.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–22  | imports + `router` | `APIRouter(prefix="/api/engines", tags=["annotations"])` |
| 24–30 | `AnnotationCreate` | Pydantic model: `type`, `props`, optional `row_key`, `page`, `style` |
| 33–38 | `AnnotationUpdate` | Pydantic model: all fields optional — supports partial update |
| 41    | `VALID_TYPES` | `{"pin", "arrow", "rectangle", "text"}` — D-DRW-07 shape set |
| 44–52 | `GET /annotations` | List all annotations for an image |
| 55–72 | `POST /annotations` | Create annotation; validates `type` against `VALID_TYPES` |
| 75–87 | `PATCH /annotations/{id}` | Partial update — position, row_key, style; 404 if missing |
| 90–101| `DELETE /annotations/{id}` | Delete single annotation; 404 if missing |

## Decisions

- **Type validation at the route layer**: `VALID_TYPES` check is done before calling the service, consistent with `ALLOWED_MIME_TYPES` in `routes_images.py`.
- **`image_id` in URL, not body**: annotations are a sub-resource of images. The URL nesting makes the ownership relationship explicit and avoids a mismatch between URL and body.
- **Pydantic `Optional` with `None` default for update fields**: callers send only the fields they want to change. The service merges. This supports the drag-to-move case (Step 10) where only `props.x/y` need updating.
- **All routes are sync**: annotation CRUD is pure SQLite I/O; no async file reads needed.
