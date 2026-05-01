# Critical Data Flows

## 1. Cell Edit

```
input.blur → _onCellBlur → _saveCell (grid.js)
  → ApiClient.updateCell  PATCH /tools/{tid}/rows/{rid}/cell?project_id=
    → service.update_cell → UPDATE "{slug}" SET col=?
      → INSERT _overrides (se cella modificata manualmente)
      → UPDATE __log (appende entry)
      → mark_tool_stale(conn, tool_id)
      → mark_dependents_stale(conn, slug)
      → serialize_active_row → JSON response
        → _updateLogCell (aggiorna SOLO la cella LOG, no re-render completo)
```

**Nota chiave**: `_updateLogCell` aggiorna solo la cella LOG nel DOM, non chiama `render()`. Questo è intenzionale per performance.

## 2. ETL Apply (da editor ETL, pulsante "Applica")

```
EtlEditor.apply → ApiClient.etlApply  POST /tools/{tid}/etl/apply
  → etl.etl_apply(conn, tool_id, sql)
    → cursor.execute(user_sql)  ← esegue SELECT sul DB progetto
    → per ogni colonna nel risultato: auto-crea se mancante (INSERT _columns + ALTER TABLE)
    → per ogni riga risultato:
        trova riga esistente per TAG, o crea nuova
        per ogni cella: salta se (tool_slug, tag, col_slug) in _overrides
        UPDATE "{slug}" SET col=?
```

**Nota**: `etl_apply` NON aggiorna `is_stale` — quello lo fa `etl_run_saved`.

## 3. ETL Run Saved (toolbar "↺ Ricarica")

```
ToolbarManager.runEtl → ApiClient.etlRunSaved  POST /tools/{tid}/etl/run
  → etl.etl_run_saved(conn, tool_id, _visited=set())
    → legge etl_deps da query_config
    → per ogni dep_slug in etl_deps:
        se dep is_stale E dep ha etl_sql:
          etl_run_saved(conn, dep_id, _visited)  ← ricorsione topologica
    → etl_apply(conn, tool_id, sql)
    → UPDATE _tools SET is_stale=0 WHERE id=tool_id
    → mark_dependents_stale(conn, tool_slug)  ← propaga a valle
```

## 4. Staleness Propagation (da qualsiasi mutazione riga)

```
service.update_cell / create_row / soft_delete_row / restore_row / paste_rows
  → mark_tool_stale(conn, tool_id)        ← ~riga 555 service.py
  → mark_dependents_stale(conn, slug)     ← ~riga 565 service.py
    → SELECT id, query_config FROM _tools
    → per ogni tool: parse etl_deps dal JSON
      → se slug in etl_deps: UPDATE _tools SET is_stale=1
```

## How to apply

- Per bug nella cell edit: inizia da `grid.js::_saveCell` → `service.py::update_cell`
- Per bug nell'ETL: distingui `etl_apply` (logica merge) da `etl_run_saved` (orchestrazione topologica)
- Qualsiasi nuova operazione che muta righe **deve** chiamare `mark_tool_stale` + `mark_dependents_stale`
