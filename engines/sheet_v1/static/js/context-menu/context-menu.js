/**
 * context-menu/context-menu.js — ContextMenu
 * Right-click context menu: open/close, item dispatch, flag submenu.
 * All grid.js state is injected via configure() — no direct grid references.
 */

const ContextMenu = (() => {

    // ---- State ----
    let _ctxRowId      = null;
    let _ctxColSlug    = null;
    let _ctxColSlugLog = null;
    let _ctxFlagsCache = null;

    // ---- Injected deps ----
    let _getRows;
    let _getFilteredRows;
    let _applyFilters;
    let _render;
    let _softDeleteRow;
    let _restoreRow;
    let _hardDeleteRow;
    let _keepRow;
    let _removeOverride;
    let _insertRowAbove;
    let _insertRowBelow;
    let _copyRowInsert;

    function configure({ getRows, getFilteredRows, applyFilters, render,
                         softDeleteRow, restoreRow, hardDeleteRow, keepRow, removeOverride,
                         insertRowAbove, insertRowBelow, copyRowInsert }) {
        _getRows         = getRows;
        _getFilteredRows = getFilteredRows;
        _applyFilters    = applyFilters;
        _render          = render;
        _softDeleteRow   = softDeleteRow;
        _restoreRow      = restoreRow;
        _hardDeleteRow   = hardDeleteRow;
        _keepRow         = keepRow;
        _removeOverride  = removeOverride;
        _insertRowAbove  = insertRowAbove;
        _insertRowBelow  = insertRowBelow;
        _copyRowInsert   = copyRowInsert;
    }


    // --------------------------------------------------------
    // INIT — attach event listeners once
    // --------------------------------------------------------

    function init() {
        const menu = document.getElementById("row-context-menu");
        if (!menu) return;

        menu.addEventListener("click", async e => {
            const item = e.target.closest("[data-action]");
            if (!item || _ctxRowId === null) return;
            const action     = item.dataset.action;
            const rowId      = _ctxRowId;
            const colSlug    = _ctxColSlug;
            const colSlugLog = _ctxColSlugLog;
            const flagsSnap  = _ctxFlagsCache;
            _close();

            if (action === "delete")          await _softDeleteRow(rowId);
            if (action === "restore")         await _restoreRow(rowId);
            if (action === "hard-delete")     await _hardDeleteRow(rowId);
            if (action === "keep-row")        await _keepRow(rowId);
            if (action === "remove-override") await _removeOverride(rowId, colSlug);
            if (action === "insert-above")    await _insertRowAbove(rowId);
            if (action === "insert-below")    await _insertRowBelow(rowId);
            if (action === "copy-insert")     await _copyRowInsert(rowId);

            if (action === "cell-log") {
                const rows         = _getRows();
                const filteredRows = _getFilteredRows();
                const cells = SelectionManager.getSelectedCells(filteredRows, ColumnsManager.getColumns());
                if (cells.length > 0) {
                    const r = rows.find(x => x.tag === cells[0].row_tag);
                    if (r) HistoryActions.openCellHistory(r.id, cells[0].col_slug, rows);
                } else {
                    HistoryActions.openCellHistory(rowId, colSlugLog, rows);
                }
            }

            if (action === "range-log") {
                HistoryActions.openRangeHistory(
                    SelectionManager.getRanges(),
                    _getFilteredRows(),
                    ColumnsManager.getColumns()
                );
            }

            if (action === "flags-trigger")     return;
            if (action === "open-flag-manager") { FlagsManager.show(); return; }

            if (action === "note-flag") {
                const flagId = parseInt(item.dataset.flagId, 10);
                const cells  = SelectionManager.getSelectedCells(_getFilteredRows(), ColumnsManager.getColumns());
                if (!cells.length || isNaN(flagId)) return;
                _showNoteEditor(flagId, cells, item);
                return;
            }

            if (action === "toggle-flag") {
                const flagId       = parseInt(item.dataset.flagId, 10);
                const filteredRows = _getFilteredRows();
                const cells        = SelectionManager.getSelectedCells(filteredRows, ColumnsManager.getColumns());
                if (!cells.length || isNaN(flagId)) return;
                try {
                    const result = await ApiClient.toggleCellFlags(flagId, cells);
                    const flag   = flagsSnap?.find(f => f.id === flagId);
                    const rows   = _getRows();
                    for (const { row_tag, col_slug } of cells) {
                        const row = rows.find(r => r.tag === row_tag);
                        if (!row) continue;
                        if (!row.cell_flags) row.cell_flags = {};
                        const arr = row.cell_flags[col_slug] ?? [];
                        if (result.action === "removed") {
                            row.cell_flags[col_slug] = arr.filter(f => f.id !== flagId);
                        } else if (flag) {
                            if (!arr.some(f => f.id === flagId))
                                row.cell_flags[col_slug] = [...arr, { ...flag, note: "" }];
                        }
                    }
                    _applyFilters();
                    _render();
                } catch (err) {
                    showToast(err.message, "error");
                }
                return;
            }
        });

        document.addEventListener("click", e => {
            if (menu.classList.contains("visible") && !menu.contains(e.target)) _close();
        });

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") _close();
        });

        const flagTriggerEl = menu.querySelector('[data-action="flags-trigger"]');
        if (flagTriggerEl) {
            flagTriggerEl.addEventListener("mouseenter", async () => {
                const listEl       = document.getElementById("ctx-flags-list");
                const filteredRows = _getFilteredRows();
                const cells        = SelectionManager.getSelectedCells(filteredRows, ColumnsManager.getColumns());
                if (_ctxFlagsCache !== null) {
                    _populateFlagsSubmenu(_ctxFlagsCache, cells);
                    return;
                }
                if (listEl) listEl.innerHTML =
                    '<div class="ctx-item" style="color:var(--color-text-muted);cursor:default;pointer-events:none">' +
                    '<span></span><span>Loading…</span><span></span></div>';
                try {
                    const all      = await ApiClient.listFlags();
                    _ctxFlagsCache = all.filter(f => !f.is_system);
                    _populateFlagsSubmenu(_ctxFlagsCache, cells);
                } catch {
                    if (listEl) listEl.innerHTML =
                        '<div class="ctx-item" style="color:var(--color-danger);cursor:default;pointer-events:none">' +
                        '<span></span><span>Error loading flags</span><span></span></div>';
                }
            });
        }
    }


    // --------------------------------------------------------
    // OPEN / CLOSE
    // --------------------------------------------------------

    function open(e, rowId, fromDeleted = false) {
        e.preventDefault();
        _ctxRowId = rowId;

        const rows = _getRows();
        const row  = rows.find(r => r.id === rowId && Boolean(r.is_deleted) === Boolean(fromDeleted));
        const menu = document.getElementById("row-context-menu");
        if (!menu || !row) return;

        // Inside range → keep selection; outside → collapse to clicked cell.
        const clickedTd = e.target.closest("td[data-row-idx][data-col-idx]");
        if (clickedTd) {
            const r      = +clickedTd.dataset.rowIdx;
            const c      = +clickedTd.dataset.colIdx;
            const ranges = SelectionManager.getRanges();
            const inside = ranges.length > 0 && ranges.some(rng => {
                const rMin = Math.min(rng.start.r, rng.end.r);
                const rMax = Math.max(rng.start.r, rng.end.r);
                const cMin = Math.min(rng.start.c, rng.end.c);
                const cMax = Math.max(rng.start.c, rng.end.c);
                return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
            });
            if (!inside) SelectionManager.collapseToCell(r, c);
        }

        const isDeleted  = row.is_deleted;
        const fromGutter = !!e.target.closest("td.gutter");
        const showGutter = fromGutter && !isDeleted;
        menu.querySelectorAll('.ctx-gutter-only').forEach(el => el.style.display = showGutter ? "" : "none");
        menu.querySelector('.ctx-sep-gutter').style.display = showGutter ? "" : "none";

        menu.querySelector('[data-action="delete"]').style.display      = isDeleted ? "none" : "";
        menu.querySelector('[data-action="restore"]').style.display     = isDeleted ? "" : "none";
        menu.querySelector('[data-action="hard-delete"]').style.display = isDeleted ? "" : "none";

        const rowCellFlags = row.cell_flags && row.cell_flags[""];
        const isEliminated = !isDeleted && rowCellFlags && rowCellFlags.some(f => f.name === "ETL: Eliminated");
        menu.querySelector('[data-action="keep-row"]').style.display  = isEliminated ? "" : "none";
        menu.querySelector('.ctx-sep-keep-row').style.display         = isEliminated ? "" : "none";

        const tdOverridden = e.target.closest("td[data-overridden='true']");
        _ctxColSlug        = tdOverridden
            ? tdOverridden.querySelector("[data-field]")?.dataset.field ?? null
            : null;
        const showOverride = !isDeleted && _ctxColSlug !== null;
        menu.querySelector('[data-action="remove-override"]').style.display = showOverride ? "" : "none";
        menu.querySelector('.ctx-sep-override').style.display               = showOverride ? "" : "none";

        const tdAny    = e.target.closest("td[data-col-idx]");
        _ctxColSlugLog = tdAny ? (tdAny.querySelector("[data-field]")?.dataset.field ?? null) : null;
        const showLogEntry = !isDeleted && _ctxColSlugLog !== null;
        const isSingle     = SelectionManager.isSingleCellSelection();
        menu.querySelector('[data-action="cell-log"]').style.display  = showLogEntry && isSingle  ? "" : "none";
        menu.querySelector('[data-action="range-log"]').style.display = showLogEntry && !isSingle ? "" : "none";
        menu.querySelector('.ctx-sep-cell-log').style.display         = showLogEntry ? "" : "none";

        const flagTrigger = menu.querySelector('[data-action="flags-trigger"]');
        const flagSep     = menu.querySelector('.ctx-sep-flags');
        if (flagTrigger) flagTrigger.style.display = showLogEntry ? "" : "none";
        if (flagSep)     flagSep.style.display     = showLogEntry ? "" : "none";
        if (flagTrigger) {
            const menuLeft = Math.min(e.clientX, window.innerWidth - 210);
            flagTrigger.classList.toggle("submenu-left", menuLeft + 195 + 190 > window.innerWidth);
        }
        _ctxFlagsCache = null;

        if (RevisionPicker.getViewingRevision() !== null) {
            ['delete', 'restore', 'hard-delete', 'keep-row', 'remove-override',
             'flags-trigger', 'insert-above', 'insert-below', 'copy-insert'].forEach(a => {
                menu.querySelector(`[data-action="${a}"]`).style.display = "none";
            });
            menu.querySelector('.ctx-sep-keep-row').style.display = "none";
            menu.querySelector('.ctx-sep-override').style.display = "none";
            menu.querySelector('.ctx-sep-flags').style.display    = "none";
            menu.querySelector('.ctx-sep-gutter').style.display   = "none";
        }

        const x = Math.min(e.clientX, window.innerWidth  - 210);
        const y = Math.min(e.clientY, window.innerHeight - 140);
        menu.style.left = x + "px";
        menu.style.top  = y + "px";
        menu.classList.add("visible");
    }

    function _close() {
        document.getElementById("row-context-menu")?.classList.remove("visible");
        _ctxRowId      = null;
        _ctxColSlug    = null;
        _ctxColSlugLog = null;
        _ctxFlagsCache = null;
    }


    // --------------------------------------------------------
    // FLAG SUBMENU HELPERS
    // --------------------------------------------------------

    function _flagCheckState(flagId, cells) {
        const rows = _getRows();
        let count = 0;
        for (const { row_tag, col_slug } of cells) {
            const row = rows.find(r => r.tag === row_tag);
            if (!row) continue;
            const arr = row.cell_flags?.[col_slug] ?? [];
            if (arr.some(f => f.id === flagId)) count++;
        }
        if (count === 0)            return "none";
        if (count === cells.length) return "all";
        return "some";
    }

    function _getExistingNote(flagId, cells) {
        const rows = _getRows();
        for (const { row_tag, col_slug } of cells) {
            const row = rows.find(r => r.tag === row_tag);
            const f   = row?.cell_flags?.[col_slug]?.find(x => x.id === flagId);
            if (f?.note) return f.note;
        }
        return "";
    }

    function _showNoteEditor(flagId, cells, triggerEl) {
        const list = document.getElementById("ctx-flags-list");
        if (!list) return;
        const existing = _getExistingNote(flagId, cells);
        const editorId = "ctx-flag-note-editor";
        const old = list.querySelector(`#${editorId}`);
        if (old) old.remove();
        const div = document.createElement("div");
        div.id = editorId;
        div.style.cssText = "padding:4px 8px;display:flex;flex-direction:column;gap:4px";
        div.innerHTML =
            `<textarea id="ctx-flag-note-ta" rows="2" placeholder="Add note…"
                style="width:100%;resize:vertical;font-size:12px;padding:4px;box-sizing:border-box"
            >${Utils.escHtml(existing)}</textarea>` +
            `<button id="ctx-flag-note-save" style="align-self:flex-end;font-size:11px">Save note</button>`;
        triggerEl.closest(".ctx-flag-item")?.insertAdjacentElement("afterend", div) || list.appendChild(div);
        const ta = div.querySelector("#ctx-flag-note-ta");
        ta.focus();
        div.querySelector("#ctx-flag-note-save").addEventListener("click", async () => {
            const note = ta.value;
            try {
                await ApiClient.updateCellFlagNote(flagId, cells, note);
                const rows = _getRows();
                for (const { row_tag, col_slug } of cells) {
                    const row = rows.find(r => r.tag === row_tag);
                    if (!row?.cell_flags?.[col_slug]) continue;
                    const f = row.cell_flags[col_slug].find(x => x.id === flagId);
                    if (f) f.note = note;
                }
                _render();
                _close();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
        ta.addEventListener("keydown", e => {
            if (e.key === "Escape") { div.remove(); }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); div.querySelector("#ctx-flag-note-save").click(); }
        });
    }

    function _populateFlagsSubmenu(flags, cells) {
        const list = document.getElementById("ctx-flags-list");
        if (!list) return;
        if (!flags.length) {
            list.innerHTML =
                '<div class="ctx-item" style="color:var(--color-text-muted);cursor:default;pointer-events:none">' +
                '<span></span><span>No flags defined</span><span></span></div>';
            return;
        }
        list.innerHTML = flags.map(flag => {
            const state      = _flagCheckState(flag.id, cells);
            const checkGlyph = state === "none" ? "" : "✓";
            const mixedClass = state === "some"  ? " ctx-flag-mixed" : "";
            const hasFlag    = state !== "none";
            const noteBtn    = hasFlag
                ? `<span class="ctx-flag-note-btn" data-action="note-flag" data-flag-id="${flag.id}" title="Edit note">✎</span>`
                : "";
            return `<div class="ctx-flag-item${mixedClass}" data-action="toggle-flag" data-flag-id="${flag.id}">` +
                   `<span class="ctx-flag-dot" style="background:${Utils.escAttr(flag.color)}"></span>` +
                   `<span style="flex:1">${Utils.escHtml(flag.name)}</span>` +
                   `${noteBtn}` +
                   `<span class="ctx-flag-check">${checkGlyph}</span>` +
                   `</div>`;
        }).join("");
    }

    function removeFlagFromCells(flagId) {
        for (const row of _getRows()) {
            if (!row.cell_flags) continue;
            for (const slug of Object.keys(row.cell_flags)) {
                row.cell_flags[slug] = row.cell_flags[slug].filter(f => f.id !== flagId);
            }
        }
        _render();
    }


    // --------------------------------------------------------
    return { configure, init, open, removeFlagFromCells };

})();
