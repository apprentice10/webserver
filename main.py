from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from core.routes import router as core_router
from engine.routes import router as engine_router

app = FastAPI(
    title="Instrument Manager",
    version="0.2.0",
    description="Web application per la progettazione elettro-strumentale"
)

# Monta la cartella static per CSS, JS e immagini
app.mount("/static", StaticFiles(directory="static"), name="static")

# Configura il motore di template Jinja2
templates = Jinja2Templates(directory="templates")
app.include_router(core_router)
app.include_router(engine_router)

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Homepage — carica la shell principale dell'applicazione."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
async def health_check():
    """Endpoint di controllo: verifica che il server sia attivo."""
    return {"status": "ok", "app": "Instrument Manager", "version": "0.2.0"}




@app.get("/tool/{project_id}/{tool_id}", response_class=HTMLResponse)
async def tool_page(request: Request, project_id: int, tool_id: int):
    """Pagina universale del Table Engine per qualsiasi tool."""
    return templates.TemplateResponse(
        request,
        "engine/table.html",
        {"project_id": project_id, "tool_id": tool_id}
    )