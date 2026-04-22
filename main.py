from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from database import engine as db_engine, Base
from core.routes import router as core_router
from engine.routes import router as engine_router

# Importa i modelli perché Base.metadata li veda
import core.models        # noqa: F401
import engine.models      # noqa: F401

app = FastAPI(
    title="Instrument Manager",
    version="0.3.0",
    description="Web application per la progettazione elettro-strumentale"
)

# Crea le tabelle del registry al primo avvio
Base.metadata.create_all(bind=db_engine)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(core_router)
app.include_router(engine_router)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "Instrument Manager", "version": "0.3.0"}


@app.get("/tool/{project_id}/{tool_id}", response_class=HTMLResponse)
async def tool_page(request: Request, project_id: int, tool_id: int):
    return templates.TemplateResponse(
        request,
        "engine/table.html",
        {"project_id": project_id, "tool_id": tool_id}
    )


@app.get("/tool/{project_id}/{tool_id}/etl", response_class=HTMLResponse)
async def etl_page(request: Request, project_id: int, tool_id: int):
    return templates.TemplateResponse(
        request,
        "engine/etl.html",
        {"project_id": project_id, "tool_id": tool_id}
    )
