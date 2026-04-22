"""
engine/catalog.py
------------------
Catalogo dei tipi di tool disponibili nell'applicazione.

Ogni entry definisce un tipo di tool installabile in un progetto.
Nuovi tipi si aggiungono semplicemente estendendo questa lista.
"""

TOOL_CATALOG = [
    {
        "type_slug": "instrument-list",
        "name": "Instrument List",
        "description": "Lista strumenti di processo: TAG, tipo, range, P&ID e note tecniche.",
        "icon": "📋",
    },
]
