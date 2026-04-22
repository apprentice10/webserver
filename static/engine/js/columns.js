/**
 * columns.js — Engine
 * --------------------
 * Gestisce le colonne dinamiche del tool:
 * - Rendering intestazioni con azioni
 * - Aggiunta, modifica, eliminazione colonne
 * - Auto-slug da nome colonna
 */

const ColumnsManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _columns = [];  // Colonne correnti ordinate per position


    // --------------------------------------------------------
    // GETTER — usato da GridManager
    // --------------------------------------------------------

    function getColumns() { return _columns; }

    async function loadColumns() {
        _columns = await ApiClient.loadColumns();
        return _columns;
    }


    // --------------------------------------------------------
    // RENDERING INTESTAZIONI
    // --------------------------------------------------------

    /**
     * Renderizza la riga <tr> dell'intestazione.
     * Chiamato da GridManager dopo il caricamento colonne.
     */
    function renderHeader() {
        const headerRow = document.getElementById("grid-header-row");

        // Colonna azioni fissa
        let html = `<th class="col-actions" style="width:56px;min-width:56px">
                        <div class="th-content">
                            <span class="th-label"></span>
                        </div>
                    </th>`;

        _columns.forEach(col => {
            html += `
                <th style="width:${col.width}px;min-width:40px"
                    data-column-id="${col.id}">
                    <div class="th-content">
                        <span class="th-label">${_escHtml(col.name)}</span>
                    </div>
                    <div class="resize-handle"
                         data-column-id="${col.id}"></div>
                </th>`;
        });

        headerRow.innerHTML = html;
        ResizeManager.init();
    }

    // --------------------------------------------------------
    // AGGIUNTA COLONNA
    // --------------------------------------------------------

    function openAddColumnModal() {
        document.getElementById("col-name").value = "";
        document.getElementById("col-slug").value = "";
        document.getElementById("col-type").value = "text";
        openModal("modal-add-column");

        // Auto-genera slug dal nome
        document.getElementById("col-name").oninput = function () {
            document.getElementById("col-slug").value = _toSlug(this.value);
        };
    }

    async function submitAddColumn() {
        const name     = document.getElementById("col-name").value.trim();
        const slug     = document.getElementById("col-slug").value.trim();
        const col_type = document.getElementById("col-type").value;

        if (!name || !slug) {
            showToast("Nome e slug sono obbligatori.", "error");
            return;
        }

        if (!/^[a-z0-9_-]+$/.test(slug)) {
            showToast("Lo slug può contenere solo lettere minuscole, numeri e trattini.", "error");
            return;
        }

        try {
            const newCol = await ApiClient.addColumn({ name, slug, col_type });
            _columns.push(newCol);
            _columns.sort((a, b) => a.position - b.position);
            closeModal("modal-add-column");

            // Re-renderizza header e griglia
            renderHeader();
            GridManager.render();

            showToast(`Colonna '${name}' aggiunta.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // RINOMINA COLONNA
    // --------------------------------------------------------

    async function renameColumn(columnId, currentName) {
        const newName = prompt(`Rinomina colonna '${currentName}':`, currentName);
        if (!newName || newName.trim() === currentName) return;

        try {
            const updated = await ApiClient.updateColumn(columnId, {
                name: newName.trim()
            });

            const idx = _columns.findIndex(c => c.id === columnId);
            if (idx !== -1) _columns[idx] = updated;

            renderHeader();
            showToast(`Colonna rinominata in '${newName}'.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // ELIMINAZIONE COLONNA
    // --------------------------------------------------------

    async function deleteColumn(columnId, columnName) {
        if (!confirm(
            `Eliminare la colonna '${columnName}'?\n` +
            `Tutti i valori in questa colonna verranno persi.`
        )) return;

        try {
            await ApiClient.deleteColumn(columnId);
            _columns = _columns.filter(c => c.id !== columnId);

            renderHeader();
            GridManager.render();

            showToast(`Colonna '${columnName}' eliminata.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // AGGIORNAMENTO LARGHEZZA (chiamato da ResizeManager)
    // --------------------------------------------------------

    function updateLocalWidth(columnId, width) {
        const col = _columns.find(c => c.id === columnId);
        if (col) col.width = width;
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _toSlug(str) {
        return str
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_-]/g, "")
            .substring(0, 50);
    }

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function _escAttr(str) {
        return String(str)
            .replace(/'/g, "\\'")
            .replace(/"/g, "&quot;");
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        getColumns,
        loadColumns,
        renderHeader,
        openAddColumnModal,
        submitAddColumn,
        renameColumn,
        deleteColumn,
        updateLocalWidth
    };

})();