/**
 * columns.js — Engine
 * --------------------
 * Manages dynamic columns: header rendering, drag reorder, add/rename/delete,
 * hide/show per-column (localStorage), system column drag (frontend-only order).
 */

const ColumnsManager = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _columns       = [];        // All columns in display order
    let _hiddenColumns = new Set(); // Slugs of hidden columns
    let _dragSrcId     = null;

    let _ctxColId   = null;
    let _ctxColName = "";


    // --------------------------------------------------------
    // GETTER
    // --------------------------------------------------------

    function getColumns()        { return _columns; }
    function getVisibleColumns() { return _columns.filter(c => !_hiddenColumns.has(c.slug)); }

    async function loadColumns() {
        _columns = await ApiClient.loadColumns();
        _loadColumnState();
        _initColContextMenu();
        return _columns;
    }

    function loadFromData(cols) {
        _columns = cols;
    }


    // --------------------------------------------------------
    // COLUMN STATE — localStorage via PanelSystem.extra
    // --------------------------------------------------------

    function _loadColumnState() {
        const hidden = PanelSystem.getExtra('hiddenColumns');
        const order  = PanelSystem.getExtra('columnOrder');
        if (hidden) _hiddenColumns = new Set(hidden);
        if (order && order.length) _applyColumnOrder(order);
        _applyHiddenColumnsCSS();
    }

    function _applyColumnOrder(order) {
        const slugToCol = new Map(_columns.map(c => [c.slug, c]));
        const ordered   = order.map(s => slugToCol.get(s)).filter(Boolean);
        _columns.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
        _columns = ordered;
    }

    function _applyHiddenColumnsCSS() {
        let style = document.getElementById('col-visibility-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'col-visibility-style';
            document.head.appendChild(style);
        }
        if (!_hiddenColumns.size) { style.textContent = ''; return; }
        const ids = _columns.filter(c => _hiddenColumns.has(c.slug)).map(c => c.id);
        if (!ids.length) { style.textContent = ''; return; }
        style.textContent = ids.map(id => `[data-column-id="${id}"]`).join(',') + ' { display: none !important; }';
    }

    function hideColumn(slug) {
        _hiddenColumns.add(slug);
        PanelSystem.setExtra('hiddenColumns', [..._hiddenColumns]);
        _applyHiddenColumnsCSS();
    }

    function showColumn(slug) {
        _hiddenColumns.delete(slug);
        PanelSystem.setExtra('hiddenColumns', [..._hiddenColumns]);
        _applyHiddenColumnsCSS();
    }

    function getHiddenColumns() { return _hiddenColumns; }


    // --------------------------------------------------------
    // HEADER RENDERING
    // --------------------------------------------------------

    function renderHeader() {
        const headerRow = document.getElementById("grid-header-row");

        let html = `<th class="col-gutter"></th>`;

        _columns.forEach(col => {
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

            const sortArrow   = col.is_system ? '' : `<span class="th-sort-arrow"></span><span class="th-sort-badge" style="display:none"></span>`;
            const filterBtn   = col.is_system ? '' : `<button class="th-filter-btn" data-slug="${col.slug}" title="Filter" draggable="false">▿</button>`;
            const sortableClass = col.is_system ? '' : ' th-sortable';
            html += `
                <th style="width:${col.width}px;min-width:20px"
                    data-column-id="${col.id}"
                    data-slug="${col.slug}"
                    data-is-system="${col.is_system ? 1 : 0}"
                    draggable="true"
                    ${lineageTitle}>
                    <div class="th-content th-draggable">
                        <span class="th-label${sortableClass}" data-slug="${col.slug}">${_escHtml(col.name)}</span>
                        ${lineageTitle ? '<span class="th-lineage-dot" aria-hidden="true">⬡</span>' : ""}
                        ${sortArrow}${filterBtn}
                    </div>
                    <div class="resize-handle" data-column-id="${col.id}" draggable="false"></div>
                </th>`;
        });

        headerRow.innerHTML = html;
        ResizeManager.init();
        _attachDragListeners();
        if (typeof SortFilterManager !== 'undefined') SortFilterManager.updateHeaderIndicators();
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
                if (parseInt(th.dataset.columnId) !== _dragSrcId) {
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
                if (targetId === _dragSrcId) return;

                const srcIdx = _columns.findIndex(c => c.id === _dragSrcId);
                const tgtIdx = _columns.findIndex(c => c.id === targetId);
                if (srcIdx === -1 || tgtIdx === -1) return;

                const [moved] = _columns.splice(srcIdx, 1);
                _columns.splice(tgtIdx, 0, moved);

                renderHeader();
                GridManager.render();

                // Save frontend display order
                PanelSystem.setExtra('columnOrder', _columns.map(c => c.slug));

                // Call backend API only for user (non-system) column reorder
                if (!moved.is_system) {
                    const userCols = _columns.filter(c => !c.is_system);
                    userCols.forEach((col, i) => { col.position = 2 + i; });
                    try {
                        await ApiClient.reorderColumns(userCols.map(c => c.id));
                    } catch (err) {
                        showToast("Errore salvataggio ordine: " + err.message, "error");
                    }
                }
            });

            th.addEventListener("contextmenu", e => {
                e.preventDefault();
                _ctxColId   = parseInt(th.dataset.columnId);
                _ctxColName = th.querySelector(".th-label")?.textContent ?? "";
                _openColContextMenu(e.clientX, e.clientY, th);
            });
        });
    }


    // --------------------------------------------------------
    // ADD COLUMN
    // --------------------------------------------------------

    function openAddColumnModal() {
        document.getElementById("col-name").value = "";
        document.getElementById("col-slug").value = "";
        document.getElementById("col-type").value = "text";
        openModal("modal-add-column");

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

            renderHeader();
            GridManager.render();

            showToast(`Colonna '${name}' aggiunta.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // RENAME COLUMN
    // --------------------------------------------------------

    async function renameColumn(columnId, currentName) {
        const newName = prompt(`Rinomina colonna '${currentName}':`, currentName);
        if (!newName || newName.trim() === currentName) return;

        const col = _columns.find(c => c.id === columnId);
        if (col && col.lineage_info) {
            const ok = confirm(
                `Rinominare '${currentName}' in '${newName.trim()}' aggiornerà l'alias AS nella query ETL salvata.\nContinuare?`
            );
            if (!ok) return;
        }

        try {
            const updated = await ApiClient.updateColumn(columnId, {
                name: newName.trim()
            });

            const idx = _columns.findIndex(c => c.id === columnId);
            if (idx !== -1) _columns[idx] = updated;

            renderHeader();
            if (updated && updated.etl_sql_updated) {
                showToast(`Colonna rinominata in '${newName.trim()}'. La query ETL è stata aggiornata.`, "success");
            } else {
                showToast(`Colonna rinominata in '${newName.trim()}'.`, "success");
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // DELETE COLUMN
    // --------------------------------------------------------

    async function deleteColumn(columnId, columnName) {
        const col = _columns.find(c => c.id === columnId);
        let confirmMsg = `Eliminare la colonna '${columnName}'?\nTutti i valori in questa colonna verranno persi.`;
        if (col && col.lineage_info) {
            const li = typeof col.lineage_info === "string"
                ? JSON.parse(col.lineage_info) : col.lineage_info;
            const src = li.from_tool
                ? `${li.from_tool}.${(li.source_expr || "").replace(/^\w+\./, "")}`
                : (li.source_expr || "ETL");
            confirmMsg = `La colonna '${columnName}' è generata da ETL (sorgente: ${src}).\n`
                + `Eliminandola, la query ETL verrà aggiornata automaticamente.\nContinuare?`;
        }
        if (!confirm(confirmMsg)) return;

        try {
            const result = await ApiClient.deleteColumn(columnId);
            _columns = _columns.filter(c => c.id !== columnId);

            renderHeader();
            GridManager.render();

            if (result && result.etl_sql_updated) {
                showToast(`Colonna '${columnName}' eliminata. La query ETL è stata aggiornata.`, "success");
            } else {
                showToast(`Colonna '${columnName}' eliminata.`, "success");
            }
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // UPDATE WIDTH (called by ResizeManager)
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
    // COLUMN HEADER CONTEXT MENU
    // --------------------------------------------------------

    function _openColContextMenu(x, y, thEl) {
        const menu = document.getElementById("col-context-menu");
        if (!menu) return;

        const hasHidden = _hiddenColumns.size > 0;
        const sep       = menu.querySelector('.ctx-sep-show-hidden');
        const trigger   = menu.querySelector('[data-action="show-hidden-trigger"]');
        if (sep)     sep.style.display     = hasHidden ? '' : 'none';
        if (trigger) {
            trigger.style.display = hasHidden ? '' : 'none';
            if (hasHidden) {
                const menuLeft = Math.min(x, window.innerWidth - 210);
                trigger.classList.toggle('submenu-left', menuLeft + 195 + 190 > window.innerWidth);
            }
        }

        menu.style.left = x + "px";
        menu.style.top  = y + "px";
        menu.classList.add("visible");
    }

    function _closeColContextMenu() {
        const menu = document.getElementById("col-context-menu");
        if (menu) menu.classList.remove("visible");
        _ctxColId = null;
    }

    function _initColContextMenu() {
        const menu = document.getElementById("col-context-menu");
        if (!menu || menu.dataset.cmInit) return;
        menu.dataset.cmInit = '1';

        menu.addEventListener("click", e => {
            const item = e.target.closest("[data-action]");
            if (!item) return;
            const action = item.dataset.action;

            if (action === "show-hidden-trigger") return;

            if (action === "show-col") {
                showColumn(item.dataset.slug);
                _closeColContextMenu();
                return;
            }

            if (_ctxColId === null) return;
            const id   = _ctxColId;
            const name = _ctxColName;
            _closeColContextMenu();

            if (action === "rename")       renameColumn(id, name);
            if (action === "delete")       deleteColumn(id, name);
            if (action === "fit-all-cols") ResizeManager.fitAll();
            if (action === "hide-col") {
                const col = _columns.find(c => c.id === id);
                if (col) hideColumn(col.slug);
            }
        });

        document.addEventListener("click", e => {
            if (menu.classList.contains("visible") && !menu.contains(e.target))
                _closeColContextMenu();
        });

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") _closeColContextMenu();
        });

        const showHiddenTrigger = menu.querySelector('[data-action="show-hidden-trigger"]');
        if (showHiddenTrigger) {
            showHiddenTrigger.addEventListener("mouseenter", () => {
                const list = document.getElementById("ctx-hidden-cols-list");
                if (!list) return;
                list.innerHTML = [..._hiddenColumns].map(slug => {
                    const col   = _columns.find(c => c.slug === slug);
                    const label = col ? _escHtml(col.name) : _escHtml(slug);
                    return `<div class="ctx-item" data-action="show-col" data-slug="${_escAttr(slug)}">` +
                           `<span class="ctx-icon">◉</span><span>${label}</span><span></span></div>`;
                }).join('');
            });
        }
    }


    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    return {
        getColumns,
        getVisibleColumns,
        getHiddenColumns,
        loadColumns,
        loadFromData,
        renderHeader,
        openAddColumnModal,
        submitAddColumn,
        renameColumn,
        deleteColumn,
        updateLocalWidth,
        hideColumn,
        showColumn,
    };

})();
