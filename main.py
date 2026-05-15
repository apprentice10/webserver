from fastapi import FastAPI, Request, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from core.routes import router as core_router, fs_router
from engine.routes import router as engine_router
from engine.routes_flags import router as flags_router
from engine.routes_etl import router as etl_router
from engine.routes_export import router as export_router
from engine.routes_revisions import router as revisions_router

app = FastAPI(
    title="Instrument Manager",
    version="0.4.0",
    description="Web application per la progettazione elettro-strumentale"
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(core_router)
app.include_router(fs_router)
app.include_router(flags_router)
app.include_router(etl_router)
app.include_router(export_router)
app.include_router(revisions_router)
app.include_router(engine_router)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "Instrument Manager", "version": "0.4.0"}


@app.get("/tool", response_class=HTMLResponse)
async def tool_page(request: Request, db: str = Query(...), tool: int = Query(...)):
    return templates.TemplateResponse(
        request, "engine/table.html", {"db": db, "tool_id": tool}
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
