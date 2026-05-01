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
| `extract_col_lineage(sql)` | Mappa `{output_col: source_expr}` dal SELECT; supporta alias (`AS`), `tbl.col`, bare identifiers; ignora `*` |
| `lineage_to_source(expr, aliases)` | Risolve `tbl.col` → `{source_expr, from_tool}` usando la mappa degli alias |

## Decisioni

- **`clean_sql` prima di ogni regex**: string literals e commenti possono contenere keyword (FROM, JOIN) — devono essere rimossi per evitare false match.
- **`resolve_etl_deps` richiede DB connection**: confronta i table refs con gli slug reali in `_tools`. È l'unica funzione con dipendenza esterna.
- **`extract_col_lineage` splitta su virgola depth-0**: gestisce funzioni annidate (es. `COALESCE(a, b)`) senza regex naive.
- **Solo operazioni su stringa** (tranne `resolve_etl_deps`): nessun side effect, nessuna scrittura.
