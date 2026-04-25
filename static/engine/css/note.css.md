# note.css

Area nota testuale in fondo al tool (sotto la griglia, sopra l'eventuale SQL editor).

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Container | `.tool-note-area` |
| Label | `.tool-note-label` |
| Textarea | `.tool-note-input` |

## Decisioni

- `max-height: 100px` sulla textarea per evitare che note lunghe comprimano la griglia. L'utente può comunque espandere a mano (resize: none disabilitato — crescita automatica gestita dal JS).
