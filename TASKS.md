# TASKS.md — Prompt Templates per Task Ricorrenti

Usa questo file come punto di partenza per ogni sessione di sviluppo.
Copia il template corrispondente al task, aggiusta i dettagli e incollalo come primo messaggio.

---

## Aggiunta nuova colonna a un tool

**Contesto da leggere:** `engine/service.py` L157–280, `engine/project_db.py` L162–181
**Memoria utile:** `project_system_columns.md`, `project_url_structure.md`

```
Aggiungi una nuova colonna [NOME] (tipo: [text|number|date]) al tool [TOOL_NAME].
- Backend: service.py::add_column, route POST /api/tools/{tid}/columns
- Frontend: columns.js::addColumn, aggiorna il form modal se necessario
- Verifica che non sia un system column (is_system=0)
```

---

## Nuovo tool type nel catalogo

**Contesto da leggere:** `engine/catalog.py`, `engine/service.py` L64–155, `engine/project_db.py` L88–125
**Memoria utile:** `project_system_columns.md`

```
Aggiungi un nuovo tipo di tool "[NAME]" (slug: [SLUG]) al catalogo.
- engine/catalog.py: aggiungi entry in TOOL_CATALOG
- Verifica che create_tool() gestisca correttamente il nuovo type_slug
- Testa creazione tool dalla UI e apertura griglia
```

---

## Nuovo endpoint API

**Contesto da leggere:** `engine/routes.py`, `engine/service.py` (sezione pertinente)
**Memoria utile:** `project_url_structure.md`, `feedback_routing.md`

```
Aggiungi endpoint [METODO] [PATH] per [FUNZIONALITÀ].
- Aggiungi schema Pydantic in engine/routes.py (sezione schemi, righe 25–143)
- Aggiungi route in engine/routes.py — ATTENZIONE: route statiche PRIMA di parametriche
- Aggiungi logica in engine/service.py
- Aggiungi chiamata in static/engine/js/api.js
```

---

## Fix bug frontend (grid/toolbar/columns)

**Contesto da leggere:** Solo il modulo JS coinvolto + `api.js` se tocca fetch
**Memoria utile:** `feedback_frontend_patterns.md`

```
Bug: [DESCRIZIONE]
File interessato: [grid.js | toolbar.js | columns.js | paste.js | resize.js]
Comportamento atteso: [...]
Comportamento attuale: [...]

Note:
- Non chiamare render() per operazioni CSS-only (es. toggle LOG)
- showToast è Utils.showToast (globale via utils.js)
- _escHtml è Utils.escHtml in tutti i moduli engine
```

---

## Modifica logica ETL

**Contesto da leggere:** `engine/etl.py`, `engine/sql_parser.py`
**Memoria utile:** `project_etl_staleness.md`, `project_data_flows.md`

```
Modifica [FUNZIONE ETL] per [MOTIVO].
- etl_apply: logica merge righe per TAG
- etl_run_saved: esecuzione topologica con _visited
- save_etl_version: salva SQL + calcola etl_deps (via sql_parser.resolve_etl_deps)
- Dopo qualsiasi modifica che muta righe: verificare mark_tool_stale + mark_dependents_stale
```

---

## Modifica staleness / dependency tracking

**Contesto da leggere:** `engine/service.py` L555–580, `engine/etl.py` (etl_run_saved)
**Memoria utile:** `project_etl_staleness.md`, `project_data_flows.md`

```
Modifica il meccanismo di staleness per [MOTIVO].
- mark_tool_stale: engine/service.py ~L555
- mark_dependents_stale: engine/service.py ~L565 (chiamata da: create_row, update_cell, soft_delete_row, restore_row, paste_rows)
- etl_run_saved: engine/etl.py (import differito per evitare circular import)
- _tools.is_stale: 0 dopo etl_run_saved, 1 dopo qualsiasi mutazione
```

---

## Aggiunta feature UI (nuovo pulsante/modal/panel)

**Contesto da leggere:** `templates/engine/table.html`, modulo JS pertinente
**Memoria utile:** `feedback_frontend_patterns.md`

```
Aggiungi [FEATURE] alla UI.
- HTML: templates/engine/table.html (toolbar ~L21-61, modali ~L114+)
- JS: aggiungere nel modulo appropriato (toolbar.js per azioni globali, grid.js per azioni riga)
- CSS: static/engine/css/table.css
- Script load order: utils.js → api.js → columns.js → resize.js → paste.js → grid.js → toolbar.js → sql_editor.js
```

---

## Debug / investigazione comportamento inatteso

**Approccio consigliato:**

1. Identifica se il problema è frontend o backend
2. Frontend → inizia dal modulo JS, traccia via Network tab del browser
3. Backend → controlla i log uvicorn, leggi solo la funzione di service.py pertinente
4. Per problemi ETL → leggi `project_etl_staleness.md` prima di toccare il codice
5. Per problemi di routing 405 → verifica ordine route in `engine/routes.py` (route statiche PRIMA)
