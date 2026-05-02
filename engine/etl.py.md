---
# engine/etl.py

**Descrizione:** Motore ETL per flat tables — preview, apply, run saved (topologico), storico versioni, schema browser.

## Indice (~382 righe)

| Righe    | Sezione |
|----------|---------|
| 1–61     | `etl_preview` — esegue la query ETL in sola lettura, restituisce colonne + righe + warning |
| 68–204   | `etl_apply` — crea colonne mancanti, merge righe per TAG, rispetta `_overrides`; **persiste SQL come draft** in `query_config` prima del commit |
| 204–255  | `etl_run_saved` — topological run con `_visited` cycle guard; import differito da service.py |
| 262–314  | `save_etl_version` — salva SQL in `query_config`, fa rotate history (max 20), estrae `etl_deps` |
| 298–314  | `etl_save_draft` — aggiorna etl_sql + etl_deps senza aggiungere voce allo storico |
| 317–331  | `get_etl_config` — legge `query_config` e restituisce `etl_sql`, `etl_history`, `etl_deps` |
| 334–366  | `get_etl_schema` — schema browser: lista tool + colonne del progetto |
| 369–382  | `_check_sql_safety` — blocca DROP / ALTER / TRUNCATE / ATTACH / PRAGMA |

## Decisioni

- **Merge per TAG**: chiave di join tra ETL source e tool destination è sempre `tag`. Righe senza tag vengono saltate con errore nella risposta.
- **`_overrides` rispettati**: per ogni cella, se esiste un record in `_overrides(tool_slug, row_tag, col_slug)`, l'ETL salta quell'aggiornamento (`skipped_cells`).
- **Import differito `from engine.service import mark_dependents_stale`** nel corpo di `etl_run_saved` (non a module top-level) per evitare circular import. Vedi RISKS.md R06 e DECISIONS.md D05.
- **`etl_deps` estratti a save-time** (in `save_etl_version` e `etl_save_draft`), non a run-time. Il campo può essere stale se il SQL è stato modificato nell'editor ma non salvato. Vedi RISKS.md R04.
- **ETL Templates** (`_templates`) sono dentro il DB per-progetto, scoped per `type_slug`. Gestiti in `engine/service.py`, non qui.
- **`SYSTEM_SLUGS`** = `{"tag", "rev", "log"}` e **`INTERNAL_COLS`** = `{"__id", "__position", "__log", "__created_at"}` — mai scritti dall'ETL, sempre saltati nel merge.
- **Lineage**: `etl_apply` chiama `sql_parser` per estrarre `col_lineage` e aggiorna `lineage_info` in `_columns` per ogni colonna ETL. Permette tracciabilità sorgente → destinazione.
