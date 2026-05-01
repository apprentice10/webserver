---
# engine/utils.py

**Descrizione:** Utility condivise tra i moduli engine: slugify, timestamp, formattazione log.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `now_str()` | Timestamp corrente come stringa `YYYY-MM-DD HH:MM:SS` |
| `slugify(text)` | Normalizza testo in slug `[a-z0-9_]` — usato per nomi colonne e tool; fallback `"tool"` se risultato vuoto |
| `format_log_entry(rev, field, old_val, new_val)` | Formatta riga log `[ts REV X] FIELD: 'old' → 'new'` |
| `append_log(existing, entry)` | Prepend entry a existing log string (nuovo in cima) |

## Decisioni

- **`slugify` è il gate obbligatorio** prima di usare qualsiasi testo come nome tabella o colonna in DDL dinamico (vedi RISKS.md R07). Mai bypassarlo.
- **`append_log` prepend** (non append): le voci più recenti stanno in cima, come un feed inverso.
