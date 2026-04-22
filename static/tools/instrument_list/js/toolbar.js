/**
 * toolbar.js
 * -----------
 * Gestisce le azioni della toolbar del tool Instrument List.
 *
 * Responsabilità:
 * - Aggiunta nuova riga (richiede TAG)
 * - Cambio revisione attiva
 * - Export Excel
 * - Aggiornamento badge REV nella topbar
 */

const ToolbarManager = (() => {

    // --------------------------------------------------------
    // INIT — carica e mostra la revisione attiva
    // --------------------------------------------------------

    async function init() {
        try {
            const rev = await ApiClient.loadRev();
            _updateRevBadge(rev.current_rev);
        } catch (err) {
            console.error("Errore caricamento revisione:", err.message);
        }
    }


    // --------------------------------------------------------
    // AGGIUNTA RIGA
    // --------------------------------------------------------

    /**
     * Chiede il TAG all'utente e aggiunge una nuova riga.
     * Il TAG è l'unico campo obbligatorio alla creazione.
     */
    async function addRow() {
        const tag = prompt("Inserisci il TAG dello strumento (es. PT-101):");

        if (tag === null) return;          // Utente ha premuto Annulla

        const trimmed = tag.trim().toUpperCase();

        if (!trimmed) {
            alert("Il TAG non può essere vuoto.");
            return;
        }

        await GridManager.addRow(trimmed);
    }


    // --------------------------------------------------------
    // REVISIONE
    // --------------------------------------------------------

    /**
     * Chiede la nuova revisione e la aggiorna nel backend.
     */
    async function changeRev() {
        const current = document.getElementById("rev-badge")
            .textContent.replace("REV ", "").trim();

        const newRev = prompt(`Revisione attuale: ${current}\nInserisci la nuova revisione:`, current);

        if (newRev === null) return;       // Utente ha premuto Annulla

        const trimmed = newRev.trim().toUpperCase();

        if (!trimmed) {
            alert("La revisione non può essere vuota.");
            return;
        }

        try {
            const updated = await ApiClient.updateRev(trimmed);
            _updateRevBadge(updated.current_rev);
        } catch (err) {
            alert("Errore: " + err.message);
        }
    }

    /**
     * Aggiorna il badge REV nella topbar.
     */
    function _updateRevBadge(rev) {
        const badge = document.getElementById("rev-badge");
        if (badge) badge.textContent = `REV ${rev}`;
    }


    // --------------------------------------------------------
    // EXPORT
    // --------------------------------------------------------

    function exportExcel() {
        ApiClient.exportExcel();
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        addRow,
        changeRev,
        exportExcel
    };

})();