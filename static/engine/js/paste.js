/**
 * paste.js — Engine
 * ------------------
 * Gestisce incolla da Excel, CSV e altre tabelle.
 *
 * Comportamento identico a Excel:
 * - Se una cella è attiva, incolla a partire da quella posizione
 *   espandendosi verso destra e verso il basso
 * - Se nessuna cella è attiva, crea nuove righe
 * - Le colonne di sistema (rev, log) non vengono mai sovrascritte
 * - Le colonne fuori range vengono ignorate silenziosamente
 */

const PasteManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    // Cella attualmente selezionata come punto di partenza
    // { rowId, rowIndex, colIndex } oppure null
    let _anchorCell = null;


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function init() {
        // Traccia quale cella è selezionata come ancora del paste
        document.addEventListener("focusin", _onFocusIn);
        document.addEventListener("paste",   _onPaste);
    }


    // --------------------------------------------------------
    // TRACKING CELLA ATTIVA
    // --------------------------------------------------------

    function _onFocusIn(e) {
        const input = e.target;

        // Cella normale della griglia
        if (input.classList.contains("cell-input") && !input.dataset.ghost) {
            const rowId = parseInt(input.dataset.rowId);
            const field = input.dataset.field;

            // Calcola indice colonna tra le colonne editabili
            const editableCols = _getEditableColumns();
            const colIndex     = editableCols.findIndex(c => c.slug === field);

            // Calcola indice riga tra le righe visibili
            const visibleRows = _getVisibleRows();
            const rowIndex    = visibleRows.findIndex(r => r.id === rowId);

            if (colIndex !== -1 && rowIndex !== -1) {
                _anchorCell = { rowId, rowIndex, colIndex, field };
            }
            return;
        }

        // Ghost row — ancora sulla prima colonna editabile
        if (input.classList.contains("cell-input") && input.dataset.ghost) {
            _anchorCell = null; // Paste sulla ghost = crea nuove righe
        }
    }


    // --------------------------------------------------------
    // HANDLER PASTE PRINCIPALE
    // --------------------------------------------------------

    async function _onPaste(e) {
        const active = document.activeElement;

        // Verifica che il focus sia nella griglia
        if (!active || !active.classList.contains("cell-input")) return;

        const text = e.clipboardData.getData("text/plain");
        if (!text) return;

        // Controlla se è un paste multi-cella
        const isMultiCell = text.includes("\n") || text.includes("\t");

        if (!isMultiCell) {
            // Paste singolo valore — lascia gestire al browser normalmente
            return;
        }

        // Paste multi-cella — gestisci noi
        e.preventDefault();

        const matrix = _parseClipboard(text);
        if (matrix.length === 0) return;

        if (_anchorCell && !active.dataset.ghost) {
            // Modalità RANGE — incolla a partire dalla cella ancora
            await _pasteRange(matrix);
        } else {
            // Modalità APPEND — crea nuove righe
            await _pasteNewRows(matrix);
        }
    }


    // --------------------------------------------------------
    // PARSING CLIPBOARD → MATRICE
    // --------------------------------------------------------

    /**
     * Converte il testo della clipboard in una matrice 2D.
     * Ogni elemento è una stringa (valore cella).
     *
     * Input Excel (TSV):
     * "PT-101\tAcqua PW\tFT\nPT-102\tVapore\tPI"
     *
     * Output:
     * [["PT-101","Acqua PW","FT"], ["PT-102","Vapore","PI"]]
     */
    function _parseClipboard(text) {
        // Rimuove trailing newline finale (Excel aggiunge sempre \n alla fine)
        const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines   = cleaned.split("\n");

        // Rimuove ultima riga se vuota (artefatto Excel)
        if (lines[lines.length - 1].trim() === "") {
            lines.pop();
        }

        if (lines.length === 0) return [];

        // Detecta separatore
        const separator = lines[0].includes("\t") ? "\t" : ",";

        return lines.map(line => _splitLine(line, separator));
    }

    /**
     * Splitta una riga rispettando le virgolette CSV.
     */
    function _splitLine(line, separator) {
        if (separator === "\t") {
            return line.split("\t").map(v => v.trim());
        }

        // CSV con gestione virgolette
        const result = [];
        let current  = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === separator && !inQuotes) {
                result.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }


    // --------------------------------------------------------
    // MODALITÀ RANGE — incolla su celle esistenti
    // --------------------------------------------------------

    /**
     * Incolla la matrice a partire dalla cella ancora.
     * Espande verso destra e verso il basso esattamente come Excel.
     */
    async function _pasteRange(matrix) {
        const editableCols = _getEditableColumns();
        const visibleRows  = _getVisibleRows();

        const startRowIdx = _anchorCell.rowIndex;
        const startColIdx = _anchorCell.colIndex;

        const updates = []; // { rowId, slug, value }
        const errors  = [];

        for (let r = 0; r < matrix.length; r++) {
            const rowIdx = startRowIdx + r;
            if (rowIdx >= visibleRows.length) break; // Fuori dalla griglia

            const row = visibleRows[rowIdx];
            if (row.is_deleted) continue; // Salta righe eliminate

            for (let c = 0; c < matrix[r].length; c++) {
                const colIdx = startColIdx + c;
                if (colIdx >= editableCols.length) break; // Fuori dalle colonne

                const col   = editableCols[colIdx];
                const value = matrix[r][c];

                updates.push({ rowId: row.id, slug: col.slug, value });
            }
        }

        if (updates.length === 0) {
            showToast("Nessuna cella aggiornata.", "info");
            return;
        }

        // Esegui aggiornamenti sequenzialmente
        showToast(`Aggiornamento ${updates.length} celle...`, "info");

        let successCount = 0;
        for (const upd of updates) {
            try {
                const updatedRow = await ApiClient.updateCell(
                    upd.rowId, upd.slug, upd.value
                );
                GridManager.updateRowData(upd.rowId, updatedRow);
                successCount++;
            } catch (err) {
                errors.push(`Riga ${upd.rowId} / ${upd.slug}: ${err.message}`);
            }
        }

        // Aggiorna visivamente la griglia
        GridManager.render();

        if (errors.length > 0) {
            console.warn("Errori paste:", errors);
            showToast(
                `${successCount} celle aggiornate, ${errors.length} errori.`,
                "error"
            );
        } else {
            showToast(`${successCount} celle aggiornate.`, "success");
        }
    }


    // --------------------------------------------------------
    // MODALITÀ APPEND — crea nuove righe
    // --------------------------------------------------------

    /**
     * Crea nuove righe dalla matrice incollata.
     * La prima colonna della matrice viene mappata al TAG.
     * Le colonne successive vengono mappate nell'ordine delle
     * colonne editabili del tool.
     */
    async function _pasteNewRows(matrix) {
        const editableCols = _getEditableColumns();

        const rowsData = matrix.map(rowValues => {
            const obj = {};
            rowValues.forEach((value, i) => {
                if (i < editableCols.length && value.trim()) {
                    obj[editableCols[i].slug] = value;
                }
            });
            return obj;
        }).filter(obj => obj.tag); // Solo righe con TAG valorizzato

        if (rowsData.length === 0) {
            showToast(
                "Nessuna riga valida trovata. " +
                "Assicurati che la prima colonna contenga il TAG.",
                "error"
            );
            return;
        }

        showToast(`Importazione ${rowsData.length} righe...`, "info");

        try {
            const result = await ApiClient.pasteRows(rowsData);
            const inserted = result.inserted || [];
            const skipped  = result.skipped  || [];

            if (inserted.length > 0) {
                GridManager.appendRows(inserted);
            }

            let message = `✓ ${inserted.length} righe importate`;
            if (skipped.length > 0) {
                message += ` — ${skipped.length} saltate`;
                console.warn("Righe saltate:", skipped);
            }

            showToast(message, inserted.length > 0 ? "success" : "error");

        } catch (err) {
            showToast("Errore importazione: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    /**
     * Restituisce le colonne editabili nell'ordine visibile.
     * Esclude REV e LOG che sono di sola lettura.
     */
    function _getEditableColumns() {
        return ColumnsManager.getColumns().filter(
            c => c.slug !== "rev" && c.slug !== "log"
        );
    }

    /**
     * Restituisce le righe attualmente visibili nella griglia
     * (esclude ghost row e righe filtrate).
     */
    function _getVisibleRows() {
        // Legge le righe dal DOM — riflette esattamente
        // quello che l'utente vede inclusi i filtri attivi
        return Array.from(
            document.querySelectorAll("tr[data-row-id]")
        ).map(tr => {
            const rowId = parseInt(tr.dataset.rowId);
            return GridManager.getRowById(rowId);
        }).filter(Boolean);
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return { init };

})();