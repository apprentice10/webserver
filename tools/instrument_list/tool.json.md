---
# tools/instrument_list/tool.json

**Descrizione:** Manifest del plugin "Instrument List". Unico file che identifica questo tipo di tool come plugin nel sistema. Nessuna logica business qui.

## Contenuto

```json
{
  "type_slug": "instrument-list",
  "name": "Instrument List",
  "description": "Lista strumenti di processo: TAG, tipo, range, P&ID e note tecniche.",
  "icon": "📋"
}
```

## Decisioni

- **Questo è tutto ciò che è "instrument-list specific"**: `type_slug`, nome visualizzato, descrizione, icona. Tutto il resto (colonne sistema, ETL engine, griglia) è infrastruttura condivisa.
- **`SYSTEM_COLUMN_DEFS` non appartiene qui**: tag/rev/log sono contratto engine, non plugin. Il manifest non li conosce e non li deve elencare.
- **Aggiungere un nuovo tool type** = creare `tools/{new_type}/tool.json` con lo stesso schema. `engine/catalog.py` lo scoprirà automaticamente al prossimo avvio del server.
