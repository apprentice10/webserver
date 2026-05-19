---
Updated: 2026-05-19 15:00

# dashboard/routes_images.py

**Description:** Image HTTP endpoints for Drawing Toolkit. Five routes mounted at `/api/engines/{slug}/tools/{tool_id}/images/`. All business logic delegated to `dashboard/images.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–27  | imports + `router` | `APIRouter(prefix="/api/engines", tags=["images"])` |
| 30–35 | `GET /images` | List all images for a tool (no blobs) |
| 38–58 | `POST /images/upload` | Multipart upload: `file` (UploadFile) + `name` (Form) + optional `source_width`/`source_height` |
| 61–72 | `GET /images/{image_id}/blob` | Serve raw blob; FastAPI streams response automatically |
| 75–83 | `DELETE /images/{image_id}` | Delete image + cascade annotations; 404 if missing |
| 86–101| `PATCH /images/{image_id}` | Replace blob only; annotations preserved; 404 if missing |

## Decisions

- **MIME validation at the route layer**: `ALLOWED_MIME_TYPES` check is done in the route before calling the service. The service itself does not re-validate — responsibility is clear.
- **Blob endpoint uses `Response(content=..., media_type=...)` directly**: FastAPI sends chunked transfer automatically for large byte payloads. No need for `StreamingResponse` unless we switch to streaming reads from SQLite.
- **`PATCH` replaces blob only — not name or dimensions**: D-DRW-15. If the caller wants to rename an image, a separate `PATCH /images/{id}/rename` endpoint can be added in a future step.
- **`async` on upload/replace routes**: required because `UploadFile.read()` is a coroutine. `list` and `delete` are sync because they do no I/O beyond sqlite.
