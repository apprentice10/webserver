import importlib
import json
import jinja2
from pathlib import Path

from fastapi import FastAPI, Request, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from core.routes import router as core_router, fs_router
from dashboard.routes_etl import router as etl_router
from dashboard.routes_toolkit import router as toolkit_router
from dashboard.routes_catalog import router as catalog_router
from dashboard.routes_images import router as images_router
from dashboard.routes_annotations import router as annotations_router
from dashboard.catalog import ENGINE_CATALOG

app = FastAPI(
    title="Instrument Manager",
    version="0.4.0",
    description="Web application per la progettazione elettro-strumentale"
)

app.mount("/static", StaticFiles(directory="static"), name="static")

_engines_dir = Path(__file__).parent / "engines"
for _engine_dir in sorted(_engines_dir.iterdir()):
    _static_dir = _engine_dir / "static"
    if _engine_dir.is_dir() and _static_dir.is_dir():
        app.mount(
            f"/engines/{_engine_dir.name}/static",
            StaticFiles(directory=str(_static_dir)),
            name=f"engine_{_engine_dir.name}_static",
        )

for _engine_dir in sorted(_engines_dir.iterdir()):
    _backend_routes = _engine_dir / "backend" / "routes.py"
    if _engine_dir.is_dir() and _backend_routes.exists():
        _mod = importlib.import_module(f"engines.{_engine_dir.name}.backend.routes")
        app.include_router(_mod.router)

_tmpl_dirs = [str(Path(__file__).parent / "templates")]
for _engine_dir in sorted(_engines_dir.iterdir()):
    _tmpl_dir = _engine_dir / "templates"
    if _engine_dir.is_dir() and _tmpl_dir.is_dir():
        _tmpl_dirs.append(str(_tmpl_dir))

_jinja_env = jinja2.Environment(
    loader=jinja2.FileSystemLoader(_tmpl_dirs),
    autoescape=jinja2.select_autoescape(["html", "xml"]),
)
templates = Jinja2Templates(env=_jinja_env)

app.include_router(core_router)
app.include_router(fs_router)
app.include_router(etl_router)
app.include_router(toolkit_router)
app.include_router(catalog_router)
app.include_router(images_router)
app.include_router(annotations_router)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "Instrument Manager", "version": "0.4.0"}


def _engine_toolkits(slug: str) -> list:
    entry = next((e for e in ENGINE_CATALOG if e.get("slug") == slug), {})
    return entry.get("toolkits", [])


@app.get("/tool", response_class=HTMLResponse)
async def tool_page(request: Request, db: str = Query(...), tool: int = Query(...)):
    return templates.TemplateResponse(
        request, "table.html", {
            "db": db,
            "tool_id": tool,
            "engine_slug": "sheet",
            "toolkits": _engine_toolkits("sheet"),
        }
    )


@app.get("/etl", response_class=HTMLResponse)
async def etl_page(request: Request, db: str = Query(...), tool: int = Query(...)):
    return templates.TemplateResponse(
        request, "engine/etl.html", {"db": db, "tool_id": tool}
    )


@app.get("/etl-design", response_class=HTMLResponse)
async def etl_design_page(request: Request, db: str = Query(...)):
    return templates.TemplateResponse(
        request, "etl_design.html", {"db": db}
    )


@app.get("/canvas", response_class=HTMLResponse)
async def etl_canvas_page(request: Request, db: str = Query(...), tool: int = Query(...)):
    return templates.TemplateResponse(
        request, "etl_canvas.html", {"db": db, "tool_id": tool}
    )


@app.get("/mto", response_class=HTMLResponse)
async def mto_page(request: Request, db: str = Query(...), tool: int = Query(...)):
    return templates.TemplateResponse(
        request, "mto_table.html", {
            "db": db,
            "tool_id": tool,
            "engine_slug": "mto",
            "toolkits": _engine_toolkits("mto"),
        }
    )
