"""
tools/instrument_list/service.py
---------------------------------
Business logic per il tool Instrument List.

Responsabilità:
- Validazione unicità TAG per progetto
- Creazione, aggiornamento, eliminazione righe
- Gestione row_log (log leggibile per riga)
- Scrittura audit_log centrale tramite core.audit
- Gestione revisione attiva (InstrumentRev)
"""

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from core.audit import write_log
from tools.instrument_list.models import InstrumentRow, InstrumentNote, InstrumentRev


# ============================================================
# COSTANTI
# ============================================================

TOOL_NAME = "instrument_list"

# Campi tecnici modificabili — usati per il diff e il log
TRACKED_FIELDS = [
    "rev", "fase", "pid", "tag", "servizio",
    "tipo", "standard", "classe", "attacco", "range", "note"
]


# ============================================================
# REVISIONE
# ============================================================

def get_or_create_rev(db: Session, project_id: int) -> InstrumentRev:
    """
    Restituisce la revisione attiva del progetto.
    Se non esiste ancora, la crea con valore default "A".
    """
    rev = db.query(InstrumentRev).filter(
        InstrumentRev.project_id == project_id
    ).first()

    if not rev:
        rev = InstrumentRev(project_id=project_id, current_rev="A")
        db.add(rev)
        db.flush()  # Ottieni l'id senza committare

    return rev


def set_rev(db: Session, project_id: int, new_rev: str) -> InstrumentRev:
    """
    Aggiorna la revisione attiva del progetto.
    """
    rev = get_or_create_rev(db, project_id)
    rev.current_rev = new_rev.strip().upper()
    db.flush()
    return rev


# ============================================================
# UTILITY — LOG
# ============================================================

def _format_log_entry(rev: str, field: str, old_val: str, new_val: str) -> str:
    """
    Formatta una riga di log leggibile per l'utente.
    Esempio: "[2024-01-15 REV B] SERVIZIO: 'Acqua PW' → 'Acqua WFI'"
    """
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    old_display = f"'{old_val}'" if old_val else "—"
    new_display = f"'{new_val}'" if new_val else "—"
    return f"[{ts} REV {rev}] {field.upper()}: {old_display} → {new_display}"


def _append_row_log(existing_log: str, new_entry: str) -> str:
    """
    Aggiunge una nuova riga al log esistente della riga.
    Le voci sono separate da newline, le più recenti in cima.
    """
    if existing_log:
        return new_entry + "\n" + existing_log
    return new_entry


# ============================================================
# CRUD — RIGHE
# ============================================================

def get_all_rows(db: Session, project_id: int) -> list[InstrumentRow]:
    """
    Restituisce tutte le righe del progetto,
    ordinate per TAG alfabetico.
    """
    return (
        db.query(InstrumentRow)
        .filter(InstrumentRow.project_id == project_id)
        .order_by(InstrumentRow.tag)
        .all()
    )


def get_row_by_id(db: Session, project_id: int, row_id: int) -> InstrumentRow:
    """
    Restituisce una singola riga per id.
    Solleva 404 se non trovata o non appartiene al progetto.
    """
    row = db.query(InstrumentRow).filter(
        InstrumentRow.id == project_id,
        InstrumentRow.project_id == project_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Strumento non trovato")
    return row


def create_row(db: Session, project_id: int, data: dict) -> InstrumentRow:
    """
    Crea una nuova riga nella lista strumenti.

    - Valida che il TAG non sia vuoto
    - Ottiene la revisione corrente e la assegna alla riga
    - Scrive nell'audit_log
    - Solleva 409 se il TAG esiste già nel progetto
    """
    tag = (data.get("tag") or "").strip()
    if not tag:
        raise HTTPException(status_code=422, detail="Il campo TAG è obbligatorio")

    rev = get_or_create_rev(db, project_id)

    row = InstrumentRow(
        project_id=project_id,
        rev=rev.current_rev,
        fase=data.get("fase"),
        pid=data.get("pid"),
        tag=tag,
        servizio=data.get("servizio"),
        tipo=data.get("tipo"),
        standard=data.get("standard"),
        classe=data.get("classe"),
        attacco=data.get("attacco"),
        range=data.get("range"),
        note=data.get("note"),
    )

    db.add(row)

    try:
        db.flush()  # Rileva subito eventuali violazioni di unicità
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"TAG '{tag}' già esistente in questo progetto"
        )

    # Audit log
    write_log(
        db=db,
        project_id=project_id,
        tool=TOOL_NAME,
        action="INSERT",
        row_id=row.id,
        new_value=tag
    )

    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, project_id: int, row_id: int, data: dict) -> InstrumentRow:
    """
    Aggiorna uno o più campi di una riga esistente.

    - Calcola il diff campo per campo
    - Aggiorna row_log con le modifiche della revisione corrente
    - Scrive ogni modifica nell'audit_log centrale
    - Solleva 409 se il nuovo TAG è già usato da un altro strumento
    """
    row = db.query(InstrumentRow).filter(
        InstrumentRow.id == row_id,
        InstrumentRow.project_id == project_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Strumento non trovato")

    rev = get_or_create_rev(db, project_id)
    log_entries = []

    for field in TRACKED_FIELDS:
        if field not in data:
            continue

        new_val = (data[field] or "").strip() if data[field] else None
        old_val = getattr(row, field)

        # Nessuna modifica — salta
        if str(old_val or "") == str(new_val or ""):
            continue

        # Validazione TAG
        if field == "tag":
            if not new_val:
                raise HTTPException(status_code=422, detail="Il TAG non può essere vuoto")

            # Controlla unicità del nuovo TAG (esclude la riga corrente)
            existing = db.query(InstrumentRow).filter(
                InstrumentRow.project_id == project_id,
                InstrumentRow.tag == new_val,
                InstrumentRow.id != row_id
            ).first()

            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"TAG '{new_val}' già esistente in questo progetto"
                )

        # Applica modifica
        setattr(row, field, new_val)

        # Audit log centrale
        write_log(
            db=db,
            project_id=project_id,
            tool=TOOL_NAME,
            action="UPDATE",
            row_id=row_id,
            field=field,
            old_value=old_val,
            new_value=new_val
        )

        # Accumula per row_log
        log_entries.append(
            _format_log_entry(rev.current_rev, field, old_val, new_val)
        )

    # Aggiorna row_log sulla riga
    if log_entries:
        combined = "\n".join(log_entries)
        row.row_log = _append_row_log(row.row_log, combined)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Conflitto TAG: valore già esistente nel progetto"
        )

    db.refresh(row)
    return row


def delete_row(db: Session, project_id: int, row_id: int) -> dict:
    """
    Elimina una riga dalla lista strumenti.
    Scrive nell'audit_log prima di eliminare (così il TAG è ancora leggibile).
    """
    row = db.query(InstrumentRow).filter(
        InstrumentRow.id == row_id,
        InstrumentRow.project_id == project_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Strumento non trovato")

    # Audit log — prima di eliminare
    write_log(
        db=db,
        project_id=project_id,
        tool=TOOL_NAME,
        action="DELETE",
        row_id=row_id,
        old_value=row.tag
    )

    db.delete(row)
    db.commit()
    return {"ok": True, "deleted_id": row_id}


# ============================================================
# NOTA DEL TOOL
# ============================================================

def get_note(db: Session, project_id: int) -> InstrumentNote:
    """
    Restituisce la nota del tool per il progetto.
    Se non esiste, la crea vuota.
    """
    note = db.query(InstrumentNote).filter(
        InstrumentNote.project_id == project_id
    ).first()

    if not note:
        note = InstrumentNote(project_id=project_id, content="")
        db.add(note)
        db.commit()
        db.refresh(note)

    return note


def update_note(db: Session, project_id: int, content: str) -> InstrumentNote:
    """
    Aggiorna la nota del tool.
    """
    note = get_note(db, project_id)
    note.content = content
    db.commit()
    db.refresh(note)
    return note