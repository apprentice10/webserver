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

            const editableCols = _getEditableColumns();
            const colIndex     = editableCols.findIndex(c => c.slug === field);

            const { filteredRows } = GridManager.getSelectionForPaste();
            const rowIndex = filteredRows.findIndex(r => r.id === rowId);

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
            // Single value — if a multi-cell range is selected, fill all cells in it
            const { ranges, filteredRows } = GridManager.getSelectionForPaste();
            if (_hasMultiCellSelection(ranges, filteredRows)) {
                e.preventDefault();
                await _pasteIntoSelection([[text]], ranges, filteredRows);
            }
            // otherwise let browser handle normally
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
        const { ranges, filteredRows } = GridManager.getSelectionForPaste();
        const useSelection = _hasMultiCellSelection(ranges, filteredRows);

        let startRowIdx, startColIdx, rowCount, colCount;

        if (useSelection) {
            const bounds = _getSelectionBounds(ranges, editableCols);
            startRowIdx = bounds.startRowIdx;
            startColIdx = bounds.startColIdx;
            rowCount    = bounds.rowCount;
            colCount    = bounds.colCount;
        } else {
            startRowIdx = _anchorCell.rowIndex;
            startColIdx = _anchorCell.colIndex;
            rowCount    = matrix.length;
            colCount    = Math.max(...matrix.map(r => r.length));
        }

        await _pasteIntoSelection(matrix, ranges, filteredRows, startRowIdx, startColIdx, rowCount, colCount, editableCols);
    }

    async function _pasteIntoSelection(matrix, ranges, filteredRows, startRowIdx, startColIdx, rowCount, colCount, editableCols) {
        if (!editableCols) editableCols = _getEditableColumns();
        if (!filteredRows) filteredRows = GridManager.getSelectionForPaste().filteredRows;

        if (startRowIdx === undefined) {
            const bounds = _getSelectionBounds(ranges, editableCols);
            startRowIdx = bounds.startRowIdx;
            startColIdx = bounds.startColIdx;
            rowCount    = bounds.rowCount;
            colCount    = bounds.colCount;
        }

        const clipRows = matrix.length;

        const updates = [];
        const errors  = [];

        for (let r = 0; r < rowCount; r++) {
            const rowIdx = startRowIdx + r;
            if (rowIdx >= filteredRows.length) break;

            const row = filteredRows[rowIdx];
            if (row.is_deleted) continue;

            for (let c = 0; c < colCount; c++) {
                const colIdx = startColIdx + c;
                if (colIdx >= editableCols.length) break;

                const col   = editableCols[colIdx];
                const clipRow = matrix[r % clipRows];
                const value   = clipRow[c % clipRow.length];

                updates.push({ rowId: row.id, slug: col.slug, value });
            }
        }

        if (updates.length === 0) {
            showToast("No cells updated.", "info");
            return;
        }

        showToast(`Updating ${updates.length} cells...`, "info");

        let successCount = 0;
        for (const upd of updates) {
            try {
                const updatedRow = await ApiClient.updateCell(upd.rowId, upd.slug, upd.value);
                GridManager.updateRowData(upd.rowId, updatedRow);
                successCount++;
            } catch (err) {
                errors.push(`Row ${upd.rowId} / ${upd.slug}: ${err.message}`);
            }
        }

        GridManager.render();

        if (errors.length > 0) {
            console.warn("Paste errors:", errors);
            showToast(`${successCount} cells updated, ${errors.length} errors.`, "error");
        } else {
            showToast(`${successCount} cells updated.`, "success");
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

    function _hasMultiCellSelection(ranges, filteredRows) {
        if (!ranges || ranges.length === 0) return false;
        let count = 0;
        for (const rng of ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            count += (rMax - rMin + 1) * (cMax - cMin + 1);
            if (count > 1) return true;
        }
        return false;
    }

    function _getSelectionBounds(ranges, editableCols) {
        let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
        for (const rng of ranges) {
            rMin = Math.min(rMin, rng.start.r, rng.end.r);
            rMax = Math.max(rMax, rng.start.r, rng.end.r);
            cMin = Math.min(cMin, rng.start.c, rng.end.c);
            cMax = Math.max(cMax, rng.start.c, rng.end.c);
        }
        // Clamp column bounds to editable columns only (selection indices are raw column indices)
        const cols  = ColumnsManager.getColumns();
        const editableSlugs = new Set(editableCols.map(c => c.slug));
        // Convert raw col indices to editable col indices
        let eMin = 0, eMax = 0, editableIdx = 0;
        let foundMin = false;
        for (let i = 0; i < cols.length; i++) {
            if (!editableSlugs.has(cols[i].slug)) continue;
            if (i >= cMin && !foundMin) { eMin = editableIdx; foundMin = true; }
            if (i <= cMax) eMax = editableIdx;
            editableIdx++;
        }
        return {
            startRowIdx: rMin,
            startColIdx: eMin,
            rowCount:    rMax - rMin + 1,
            colCount:    eMax - eMin + 1
        };
    }

    /**
     * Restituisce le colonne editabili nell'ordine visibile.
     * Esclude REV e LOG che sono di sola lettura.
     */
    function _getEditableColumns() {
        return ColumnsManager.getColumns().filter(
            c => c.slug !== "rev" && c.slug !== "log"
        );
    }

    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return { init };

})();