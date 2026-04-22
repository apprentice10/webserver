/**
 * api.js
 * -------
 * Client HTTP per il tool Instrument List.
 * Unico modulo autorizzato a fare fetch verso il backend.
 *
 * Tutti i metodi sono async e restituiscono dati già parsati.
 * Gli errori HTTP vengono normalizzati e rilanciati come Error
 * con il messaggio del backend, pronti per essere mostrati all'utente.
 */

const ApiClient = (() => {

    // --------------------------------------------------------
    // UTILITY INTERNA
    // --------------------------------------------------------

    /**
     * Esegue una fetch e normalizza errori HTTP.
     * @param {string} url
     * @param {object} options - opzioni fetch standard
     * @returns {Promise<any>} - JSON parsato
     */
    async function request(url, options = {}) {
        const response = await fetch(url, {
            headers: { "Content-Type": "application/json" },
            ...options
        });

        if (!response.ok) {
            // Prova a leggere il messaggio di errore dal backend
            let detail = `Errore HTTP ${response.status}`;
            try {
                const err = await response.json();
                detail = err.detail || detail;
            } catch (_) {}
            throw new Error(detail);
        }

        // 204 No Content — nessun body
        if (response.status === 204) return null;

        return response.json();
    }


    // --------------------------------------------------------
    // RIGHE
    // --------------------------------------------------------

    /**
     * Carica tutte le righe del progetto.
     * @returns {Promise<Array>}
     */
    async function loadRows() {
        return request(`/api/instrument-list/${PROJECT_ID}/rows`);
    }

    /**
     * Crea una nuova riga.
     * @param {object} data - almeno { tag }
     * @returns {Promise<object>} - riga creata
     */
    async function createRow(data) {
        return request(`/api/instrument-list/${PROJECT_ID}/rows`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    /**
     * Aggiorna uno o più campi di una riga esistente.
     * @param {number} rowId
     * @param {object} data - solo i campi modificati
     * @returns {Promise<object>} - riga aggiornata
     */
    async function updateRow(rowId, data) {
        return request(`/api/instrument-list/${PROJECT_ID}/rows/${rowId}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }

    /**
     * Elimina una riga.
     * @param {number} rowId
     * @returns {Promise<object>}
     */
    async function deleteRow(rowId) {
        return request(`/api/instrument-list/${PROJECT_ID}/rows/${rowId}`, {
            method: "DELETE"
        });
    }


    // --------------------------------------------------------
    // REVISIONE
    // --------------------------------------------------------

    /**
     * Carica la revisione attiva del progetto.
     * @returns {Promise<object>} - { project_id, current_rev }
     */
    async function loadRev() {
        return request(`/api/instrument-list/${PROJECT_ID}/rev`);
    }

    /**
     * Aggiorna la revisione attiva.
     * @param {string} rev
     * @returns {Promise<object>}
     */
    async function updateRev(rev) {
        return request(`/api/instrument-list/${PROJECT_ID}/rev`, {
            method: "PATCH",
            body: JSON.stringify({ rev })
        });
    }


    // --------------------------------------------------------
    // NOTA
    // --------------------------------------------------------

    /**
     * Carica la nota del tool.
     * @returns {Promise<object>} - { project_id, content }
     */
    async function loadNote() {
        return request(`/api/instrument-list/${PROJECT_ID}/note`);
    }

    /**
     * Salva la nota del tool.
     * @param {string} content
     * @returns {Promise<object>}
     */
    async function saveNote(content) {
        return request(`/api/instrument-list/${PROJECT_ID}/note`, {
            method: "PATCH",
            body: JSON.stringify({ content })
        });
    }


    // --------------------------------------------------------
    // SQL EDITOR
    // --------------------------------------------------------

    /**
     * Esegue una query SQL sul database del progetto.
     * @param {string} sql
     * @returns {Promise<object>} - { columns, rows, rowcount }
     */
    async function runSql(sql) {
        return request(`/api/instrument-list/${PROJECT_ID}/sql`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }


    // --------------------------------------------------------
    // EXPORT
    // --------------------------------------------------------

    /**
     * Scarica l'export Excel del tool.
     * Gestito separatamente perché la risposta è un file binario.
     */
    function exportExcel() {
        window.location.href = `/api/instrument-list/${PROJECT_ID}/export/excel`;
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        loadRows,
        createRow,
        updateRow,
        deleteRow,
        loadRev,
        updateRev,
        loadNote,
        saveNote,
        runSql,
        exportExcel
    };

})();