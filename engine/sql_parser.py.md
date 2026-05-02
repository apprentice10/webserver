---
# engine/sql_parser.py

**Descrizione:** Parsing SQL per estrarre riferimenti a tabelle, alias, lineage colonne. Usato da `etl.py` per calcolare `etl_deps` e `lineage_info`.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `clean_sql(sql)` | Rimuove string literals, commenti line e block — prepara SQL per regex sicure |
| `extract_table_refs(sql)` | Lista nomi tabella da clausole FROM/JOIN (order-preserving, deduplicated) |
| `resolve_etl_deps(conn, sql)` | Filtra `extract_table_refs` mantenendo solo slug presenti in `_tools` — restituisce dipendenze ETL |
| `extract_table_aliases(sql)` | Mappa `{alias: table_name}` da FROM/JOIN; include anche `{table_name: table_name}` per lookup unificato |
| `_depth0_split(col_list_raw)` | Split di una lista SELECT su virgole depth-0 (ignora virgole dentro parentesi); helper privato riusato da `extract_col_lineage` e `remove_col_from_sql` |
| `_col_alias(item)` | Restituisce l'alias output di un item SELECT (case-insensitive); None per `*` o espressioni non risolvibili |
| `extract_col_lineage(sql)` | Mappa `{output_col: source_expr}` dal SELECT; supporta alias (`AS`), `tbl.col`, bare identifiers; ignora `*` |
| `lineage_to_source(expr, aliases)` | Risolve `tbl.col` → `{source_expr, from_tool}` usando la mappa degli alias |
| `_output_select_span(text)` | Restituisce `(col_list_start, col_list_end)` per il SELECT di output: per CTE è l'ULTIMO SELECT a depth 0; gestisce anche SELECT senza FROM |
| `remove_col_from_sql(sql, col_alias)` | Rimuove un'espressione SELECT per alias; raises HTTPException(400) se è l'unica colonna rimasta; supporta CTE e SELECT-without-FROM |
| `rename_col_in_sql(sql, old_alias, new_alias)` | Rinomina l'alias AS di un'espressione SELECT; sostituisce `AS old` o appende `AS new`; supporta CTE e SELECT-without-FROM |

## Decisioni

- **`clean_sql` prima di ogni regex**: string literals e commenti possono contenere keyword (FROM, JOIN) — devono essere rimossi per evitare false match.
- **`resolve_etl_deps` richiede DB connection**: confronta i table refs con gli slug reali in `_tools`. È l'unica funzione con dipendenza esterna.
- **`extract_col_lineage` splitta su virgola depth-0**: gestisce funzioni annidate (es. `COALESCE(a, b)`) senza regex naive.
- **`_output_select_span` invece di regex `SELECT…FROM`**: il vecchio `re.search(r'\bSELECT\b(.+?)\bFROM\b')` trovava il PRIMO SELECT (sbagliato per CTE) e falliva senza FROM. La nuova funzione scansiona depth-0, raccoglie tutti i SELECT, prende l'ultimo.
- **Solo operazioni su stringa** (tranne `resolve_etl_deps`): nessun side effect, nessuna scrittura.
