"""
tools/instrument_list/defaults.py
-----------------------------------
Definisce le colonne default per il tool Instrument List.

Queste colonne vengono create automaticamente quando
l'utente crea un nuovo tool Instrument List.

Le colonne di sistema (TAG, REV, LOG) sono gestite
dall'engine — non vanno definite qui.
"""

# Colonne default Instrument List
# Posizioni: TAG=0, REV=1, [queste]=2..N, LOG=999
DEFAULT_COLUMNS = [
    {"name": "FASE",     "slug": "fase",     "col_type": "text", "width": 70,  "position": 2},
    {"name": "P&ID",     "slug": "pid",      "col_type": "text", "width": 80,  "position": 3},
    {"name": "SERVIZIO", "slug": "servizio", "col_type": "text", "width": 220, "position": 4},
    {"name": "TIPO",     "slug": "tipo",     "col_type": "text", "width": 80,  "position": 5},
    {"name": "STANDARD", "slug": "standard", "col_type": "text", "width": 110, "position": 6},
    {"name": "CLASSE",   "slug": "classe",   "col_type": "text", "width": 80,  "position": 7},
    {"name": "ATTACCO",  "slug": "attacco",  "col_type": "text", "width": 90,  "position": 8},
    {"name": "RANGE",    "slug": "range",    "col_type": "text", "width": 120, "position": 9},
    {"name": "NOTE",     "slug": "note",     "col_type": "text", "width": 180, "position": 10},
]