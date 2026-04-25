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
    // Stato drag-and-drop colonne
    let _dragSrcId = null;

    function renderHeader() {
        const headerRow = document.getElementById("grid-header-row");

        let html = "";

        _columns.forEach(col => {
            const draggable = col.is_system ? "" : 'draggable="true"';
            const dragClass = col.is_system ? "" : " th-draggable";

            let lineageTitle = "";
            if (col.lineage_info) {
                try {
                    const li = typeof col.lineage_info === "string"
                        ? JSON.parse(col.lineage_info)
                        : col.lineage_info;
                    if (li.from_tool) {
                        lineageTitle = `title="Fonte: ${_escAttr(li.from_tool)}.${_escAttr(li.source_expr.replace(/^\w+\./, ''))}"`;
                    } else if (li.source_expr) {
                        lineageTitle = `title="Fonte: ${_escAttr(li.source_expr)}"`;
                    }
                } catch (_) {}
            }

            html += `
                <th style="width:${col.width}px;min-width:40px"
                    data-column-id="${col.id}"
                    data-slug="${col.slug}"
                    data-is-system="${col.is_system ? 1 : 0}"
                    ${draggable}
                    ${lineageTitle}>
                    <div class="th-content${dragClass}">
                        <span class="th-label">${_escHtml(col.name)}</span>
                        ${lineageTitle ? '<span class="th-lineage-dot" aria-hidden="true">⬡</span>' : ""}
                    </div>
                    <div class="resize-handle" data-column-id="${col.id}" draggable="false"></div>
                </th>`;
        });

        headerRow.innerHTML = html;
        ResizeManager.init();
        _attachDragListeners();
    }

    function _attachDragListeners() {
        const ths = document.querySelectorAll("th[draggable='true']");

        ths.forEach(th => {
            th.addEventListener("dragstart", e => {
                if (e.target.classList.contains("resize-handle")) {
                    e.preventDefault();
                    return;
                }
                _dragSrcId = parseInt(th.dataset.columnId);
                th.classList.add("col-dragging");
                e.dataTransfer.effectAllowed = "move";
            });

            th.addEventListener("dragend", () => {
                document.querySelectorAll("th").forEach(t => {
                    t.classList.remove("col-dragging", "col-dragover");
                });
            });

            th.addEventListener("dragover", e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (parseInt(th.dataset.columnId) !== _dragSrcId && th.dataset.isSystem !== "1") {
                    document.querySelectorAll("th").forEach(t => t.classList.remove("col-dragover"));
                    th.classList.add("col-dragover");
                }
            });

            th.addEventListener("dragleave", () => {
                th.classList.remove("col-dragover");
            });

            th.addEventListener("drop", async e => {
                e.preventDefault();
                const targetId = parseInt(th.dataset.columnId);
                if (targetId === _dragSrcId || th.dataset.isSystem === "1") return;

                // Riordina l'array locale (solo colonne utente)
                const userCols  = _columns.filter(c => !c.is_system);
                const srcIdx    = userCols.findIndex(c => c.id === _dragSrcId);
                const tgtIdx    = userCols.findIndex(c => c.id === targetId);
                if (srcIdx === -1 || tgtIdx === -1) return;

                const [moved] = userCols.splice(srcIdx, 1);
                userCols.splice(tgtIdx, 0, moved);

                // Aggiorna posizioni nel array completo
                let pos = 2;
                _columns = _columns.map(c => {
                    if (!c.is_system) {
                        const updated = userCols.find(u => u.id === c.id);
                        return updated ? { ...updated, position: pos++ } : c;
                    }
                    return c;
                });
                _columns.sort((a, b) => {
                    if (a.slug === "log") return 1;
                    if (b.slug === "log") return -1;
                    return a.position - b.position;
                });

                renderHeader();
                GridManager.render();

                // Salva nel backend
                try {
                    await ApiClient.reorderColumns(userCols.map(c => c.id));
                } catch (err) {
                    showToast("Errore salvataggio ordine: " + err.message, "error");
                }
            });
        });
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

    const _escHtml = Utils.escHtml;

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