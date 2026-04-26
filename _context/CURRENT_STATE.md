# CURRENT_STATE.md
_Last updated: 2026-04-25 (session 2)_

Storico feature completate → `_context/DONE.md`

## In Progress

_(none)_

## Next Priorities (ordered by value/effort)

### Gruppo A — Quick UX wins (basso sforzo, alto impatto)

1. ~~**Horizontal scrollbar** for wide tables (CSS/layout, low effort)~~ ✓
2. ~~**Toggle REV column visibility** (same CSS pattern as LOG toggle)~~ ✓
3. ~~**Double-click column border** to auto-fit width (resize.js)~~ ✓
4. ~~**Single click = selezione cella, double click = modalità modifica**~~ ✓
5. ~~**Row numbers** — aggiungere colonna indice stile Excel (colonna fissa sinistra, stile uguale agli header colonna, non editabile)~~ ✓

### Gruppo B — Indicatori visivi celle (medio sforzo, dipende da A.4)

6. ~~**Triangolo `is_overridden`** — il flag esiste già in DB; aggiungere indicatore visivo (triangolo rosso top-left, CSS `::before`) sulle celle dove `is_overridden = true`~~ ✓
7. ~~**Tooltip valore originale ETL** — su hover del triangolo, mostrare il valore ETL precedente alla modifica manuale (recuperato da `_audit` o campo dedicato)~~ ✓
8. ~~**Azione "Rimuovi modifica manuale"** — nel context menu, ripristina valore originale ETL e cancella da `_overrides`~~ ✓
9. **Export to Excel** (openpyxl, medium effort)

### Gruppo C — Range selection e clipboard (alto sforzo, dipende da A.4)

10. **Range selection base** — click+drag per selezionare range di celle; highlight visivo del range selezionato (`grid.js`)
11. **Shift+click per estendere range** — estensione selezione con Shift+click
12. **Ctrl+click per selezione discontinua** — selezione multipla non contigua
13. **Click su header colonna = seleziona colonna intera** — click sinistro su `<th>` seleziona tutte le celle della colonna
14. **Click su row number = seleziona riga intera** — click sinistro sul numero di riga seleziona la riga completa
15. **Copia range stile Excel** — `Ctrl+C` su range selezionato copia in clipboard con struttura righe/colonne (tab-separated, clipboard API)
16. **Right-click dentro range = mantieni selezione + context menu range** — non perdere la selezione al click destro
17. **Right-click fuori range = nuova selezione + context menu singola cella**

### Gruppo D — Sidebar contestuale (alto sforzo, dipende da B e C)

Sostituisce/affianca il context menu attuale con una sidebar destra dinamica.

18. **Sidebar shell** — pannello collassabile lato destro, toggle da toolbar; struttura HTML/CSS in `table.html`
19. **Sidebar: stato singola cella** — modifica, visualizza log cella, ripristina valore originale
20. **Sidebar: stato range** — elimina righe selezionate, log del range
21. **Sidebar: stato riga** — elimina riga, ripristina riga
22. **Sidebar: stato colonna** — visualizza provenienza ETL della colonna (da `etl_deps`)
23. **Right-click su header colonna** — apre strumenti colonna nella sidebar (provenienza ETL)
24. **Right-click su row number** — apre strumenti riga nella sidebar (elimina riga)

### Gruppo E — Sistema FLAG (alto sforzo, dipende da B e D)

25. **Schema DB flag** — tabella `_cell_flags(tool_slug, row_tag, col_slug, flag_id)` + tabella `_flags(id, name, color, is_system)` nel DB di progetto; flag di sistema "manual_edit" pre-inserito
26. **Flag management window** — pagina/modale dedicata: crea/modifica/elimina flag con nome+colore; flag di sistema: solo colore modificabile
27. **Indicatore visivo multi-flag** — celle con flag mostrano triangoli/badge colorati (stacking multiplo)
28. **Tooltip flag** — hover su triangolo sistema → valore originale ETL; hover su flag utente → nome flag
29. **Sidebar: sezione FLAG** — aggiungi flag, lista flag presenti nella cella, rimuovi singolo flag

### Gruppo F — ETL SQL Editor migliorato (medio sforzo, indipendente)

30. **SQL syntax highlighting** — integrare CodeMirror o Monaco Editor in `etl_editor.js`; mantenere compatibilità con il salvataggio esistente
31. **SQL auto-formatting** — indentazione automatica SQL al caricamento e on-demand
32. **Code folding + validazione sintassi** (opzionale, dopo highlighting)

### Gruppo G — LOG come sistema Undo (alto sforzo, dipende da B e C)

33. **Rollback singola cella** — da LOG, ripristina valore precedente di una cella (nuova API `POST /rows/{row_id}/rollback?col=X&rev=N`)
34. **Rollback riga** — ripristina tutti i valori di una riga a una revisione precedente
35. **Rollback range** — rollback su range selezionato
36. **Studio impatto performance** — valutare se il log crescente richiede paginazione o pruning

### Gruppo H — ETL bidirezionale (molto alto sforzo, dipende da F)

Studio e implementazione della relazione bidirezionale Tabella → SQL.

37. **Analisi fattibilità** — mappare quali operazioni sulla tabella hanno corrispondenza SQL univoca
38. **Eliminazione colonna → aggiornamento SQL** — se una colonna ETL-generata viene eliminata, rimuovere la clausola SQL corrispondente
39. **Trasformazioni visive → SQL** — prefix/suffix/replace/formula generano SQL equivalente automaticamente

### Gruppo I — Gestione file progetto (alto sforzo, dipende da architettura)

40. **Salva progetto come file** — copia del `.db` di progetto in posizione scelta dall'utente (API `GET /projects/{id}/export`)
41. **Apri progetto da file** — upload/path di un `.db` esistente, registra nel registry (API `POST /projects/import`)
42. **Backup automatico** — backup periodico o pre-operazione distruttiva

### Gruppo J — Compatibilità DB ↔ Webserver (alto sforzo, dipende da I)

43. **Schema versioning** — campo `schema_version` in ogni progetto DB; tabella `_schema_version` con numero versione corrente
44. **Verifica compatibilità all'apertura** — controllo versione al `open_project_db()`, warning se mismatch
45. **Migrazioni automatiche** — runner di migrazioni per portare DB vecchi alla versione corrente
46. **Rollback sicurezza** — backup automatico pre-migrazione
47. **Futura compatibilità PostgreSQL** — astrarre query raw sqlite3 in layer compatibile

---

### Backlog strumenti (bassa priorità)

- **Cable List tool** (new type_slug, custom system columns)
- **I/O List tool** (new type_slug)
- **Workspace file system** (`.imanager` files — largest effort)

## Paused / Deferred

- EAV→flat migration tooling (already migrated, no active need)
- Multi-user / concurrency (single-user app for now)
