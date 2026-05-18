/* MTO materials table — cell-edit, add/delete row, drag-to-reorder. */
const MtoMaterials = (() => {
    const COLS = [
        { key: 'tag',              label: 'TAG',         editable: false },
        { key: 'part_description', label: 'Description', editable: true  },
        { key: 'size',             label: 'Size',        editable: true  },
        { key: 'material',         label: 'Material',    editable: true  },
        { key: 'uom',              label: 'UOM',         editable: true  },
        { key: 'quantity',         label: 'Qty',         editable: true  },
        { key: 'total',            label: 'Total',       editable: false },
    ];

    let _toolId = null;
    let _db = null;
    let _activeDrag = null;  // { typicalId, tagValue } while annotation drag is live

    function _q()   { return `db=${encodeURIComponent(_db)}`; }
    function _esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ── API ───────────────────────────────────────────────────────────────

    async function _apiFetch(typicalId) {
        const r = await fetch(`/api/engines/mto/${_toolId}/materials/${typicalId}?${_q()}`);
        return r.ok ? r.json() : { columns: [], rows: [], utility_count: 0 };
    }

    async function _apiPost(typicalId) {
        const r = await fetch(
            `/api/engines/mto/${_toolId}/materials/${typicalId}?${_q()}`,
            { method: 'POST' }
        );
        return r.ok ? r.json() : null;
    }

    async function _apiPatch(typicalId, rowId, column, value) {
        const r = await fetch(
            `/api/engines/mto/${_toolId}/materials/${typicalId}/${rowId}?${_q()}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ column, value }) }
        );
        return r.ok ? r.json() : null;
    }

    async function _apiDelete(typicalId, rowId) {
        const r = await fetch(
            `/api/engines/mto/${_toolId}/materials/${typicalId}/${rowId}?${_q()}`,
            { method: 'DELETE' }
        );
        return r.ok;
    }

    async function _apiReorder(typicalId, orderedIds) {
        const r = await fetch(
            `/api/engines/mto/${_toolId}/materials/${typicalId}/reorder?${_q()}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordered_ids: orderedIds }) }
        );
        return r.ok;
    }

    // ── Render ────────────────────────────────────────────────────────────

    function _render(wrap, typicalId, rows) {
        const thead =
            '<tr><th class="mto-mat-th-drag"></th>' +
            COLS.map(c => `<th>${_esc(c.label)}</th>`).join('') +
            '<th></th></tr>';

        const tbody = rows.map(row => {
            const cells = COLS.map(c => {
                const cls = c.editable ? 'mto-mat-cell mto-mat-editable' : 'mto-mat-cell mto-mat-ro';
                return `<td class="${cls}" data-col="${c.key}">${_esc(row[c.key] ?? '')}</td>`;
            }).join('');
            return `<tr data-row-id="${row.id}">` +
                `<td class="mto-mat-drag-cell">` +
                `<span class="mto-mat-handle" title="Drag to reorder">⠿</span>` +
                `<span class="mto-mat-annot-handle" title="Drag to place on image">⊕</span>` +
                `</td>` +
                cells +
                `<td class="mto-mat-actions-cell"><button class="mto-mat-del" title="Delete row" data-row-id="${row.id}">✕</button></td>` +
                '</tr>';
        }).join('');

        wrap.innerHTML =
            `<table class="mto-materials-table">` +
            `<thead>${thead}</thead>` +
            `<tbody>${tbody}</tbody>` +
            `</table>`;

        const tbodyEl = wrap.querySelector('tbody');
        _bindEdit(tbodyEl, typicalId, rows);
        _bindDelete(tbodyEl, typicalId, rows);
        _bindDrag(tbodyEl, typicalId);
        _bindAnnotDrag(tbodyEl, typicalId, rows);
    }

    // ── Inline cell edit ──────────────────────────────────────────────────

    function _bindEdit(tbody, typicalId, rows) {
        tbody.addEventListener('click', e => {
            const td = e.target.closest('.mto-mat-editable');
            if (!td || td.querySelector('input')) return;
            const tr = td.closest('tr');
            const row = rows.find(r => r.id === +tr.dataset.rowId);
            if (!row) return;
            _startEdit(td, row, typicalId);
        });
    }

    function _startEdit(td, row, typicalId) {
        const col  = td.dataset.col;
        const orig = td.textContent;
        const input = document.createElement('input');
        input.type = col === 'quantity' ? 'number' : 'text';
        input.value = orig;
        input.className = 'mto-mat-input';
        td.textContent = '';
        td.appendChild(input);
        input.focus();
        input.select();

        let done = false;

        async function save() {
            if (done) return;
            done = true;
            const val = col === 'quantity' ? (parseFloat(input.value) || 0) : input.value;
            if (String(val) === orig) { td.textContent = orig; return; }
            td.textContent = '…';
            const updated = await _apiPatch(typicalId, row.id, col, val);
            if (updated) {
                Object.assign(row, updated);
                td.textContent = updated[col] ?? '';
                const totalTd = td.closest('tr').querySelector('[data-col="total"]');
                if (totalTd) totalTd.textContent = updated.total ?? '';
            } else {
                td.textContent = orig;
                if (typeof Utils !== 'undefined') Utils.showToast('Save failed', 'error');
            }
        }

        function cancel() {
            if (done) return;
            done = true;
            td.textContent = orig;
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { cancel(); }
        });
    }

    // ── Delete row ────────────────────────────────────────────────────────

    function _bindDelete(tbody, typicalId, rows) {
        tbody.addEventListener('click', async e => {
            const btn = e.target.closest('.mto-mat-del');
            if (!btn) return;
            const rowId = +btn.dataset.rowId;
            if (!confirm('Delete this materials row?')) return;
            const ok = await _apiDelete(typicalId, rowId);
            if (ok) {
                const tr = tbody.querySelector(`tr[data-row-id="${rowId}"]`);
                if (tr) tr.remove();
                const idx = rows.findIndex(r => r.id === rowId);
                if (idx !== -1) rows.splice(idx, 1);
            } else {
                if (typeof Utils !== 'undefined') Utils.showToast('Delete failed', 'error');
            }
        });
    }

    // ── Drag-to-reorder ───────────────────────────────────────────────────

    function _bindDrag(tbody, typicalId) {
        let _drag = null;
        let _line = null;

        function _getLine() {
            if (!_line) {
                _line = document.createElement('div');
                _line.className = 'mto-mat-drop-line';
                document.body.appendChild(_line);
            }
            return _line;
        }

        function _hideLine() { if (_line) _line.style.display = 'none'; }

        function _targetRow(y) {
            for (const tr of tbody.querySelectorAll('tr[data-row-id]')) {
                const r = tr.getBoundingClientRect();
                if (y < r.top + r.height / 2) return tr;
            }
            return null;
        }

        function _showLine(y, rect) {
            const line = _getLine();
            Object.assign(line.style, {
                top: `${y + window.scrollY}px`,
                left: `${rect.left + window.scrollX}px`,
                width: `${rect.width}px`,
                display: 'block',
            });
        }

        tbody.addEventListener('mousedown', e => {
            if (!e.target.closest('.mto-mat-handle')) return;
            e.preventDefault();
            _drag = e.target.closest('tr');
            const startY = e.clientY;
            let moved = false;

            function onMove(ev) {
                if (!moved && Math.abs(ev.clientY - startY) < 4) return;
                moved = true;
                _drag.classList.add('mto-mat-dragging');
                const tgt = _targetRow(ev.clientY);
                if (tgt && tgt !== _drag) {
                    const r = tgt.getBoundingClientRect();
                    _showLine(r.top, r);
                } else if (!tgt) {
                    const rows = [...tbody.querySelectorAll('tr[data-row-id]')];
                    const last = rows[rows.length - 1];
                    if (last) { const r = last.getBoundingClientRect(); _showLine(r.bottom, r); }
                }
            }

            async function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                _hideLine();
                if (!_drag) return;
                _drag.classList.remove('mto-mat-dragging');
                if (!moved) { _drag = null; return; }

                const tgt = _targetRow(ev.clientY);
                if (tgt === _drag || tgt === _drag.nextElementSibling) { _drag = null; return; }
                tgt ? tbody.insertBefore(_drag, tgt) : tbody.appendChild(_drag);

                const ids = [...tbody.querySelectorAll('tr[data-row-id]')].map(tr => +tr.dataset.rowId);
                await _apiReorder(typicalId, ids);
                _drag = null;
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── TAG annotation drag source ────────────────────────────────────────

    function _bindAnnotDrag(tbody, typicalId, rows) {
        let _pill = null;

        function _movePill(x, y) {
            if (!_pill) return;
            _pill.style.left = `${x + 14}px`;
            _pill.style.top  = `${y - 12}px`;
        }

        tbody.addEventListener('mousedown', e => {
            if (!e.target.closest('.mto-mat-annot-handle')) return;
            e.preventDefault();
            e.stopPropagation();
            const tr = e.target.closest('tr');
            const row = rows.find(r => r.id === +tr.dataset.rowId);
            if (!row) return;

            _activeDrag = { typicalId, tagValue: row.tag || '' };

            _pill = document.createElement('div');
            _pill.className = 'mto-mat-tag-pill';
            _pill.textContent = row.tag || '—';
            document.body.appendChild(_pill);
            _movePill(e.clientX, e.clientY);

            function onMove(ev) { _movePill(ev.clientX, ev.clientY); }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (_pill) { _pill.remove(); _pill = null; }
                _activeDrag = null;
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Public ────────────────────────────────────────────────────────────

    async function load(toolId, typicalId, db, container) {
        _toolId = toolId;
        _db = db;

        let section = container.querySelector('.mto-materials-section');
        if (!section) {
            section = document.createElement('section');
            section.className = 'mto-materials-section';
            section.innerHTML =
                '<div class="mto-materials-header">' +
                '<h3 class="mto-section-title">Materials</h3>' +
                '<button class="btn btn-ghost btn-sm mto-mat-add-btn">+ Add Row</button>' +
                '</div>' +
                '<div class="mto-materials-wrap"></div>';
            container.appendChild(section);
            section.querySelector('.mto-mat-add-btn').addEventListener('click', async () => {
                const newRow = await _apiPost(typicalId);
                if (!newRow) { if (typeof Utils !== 'undefined') Utils.showToast('Add row failed', 'error'); return; }
                await load(toolId, typicalId, db, container);
            });
        }

        const wrap = section.querySelector('.mto-materials-wrap');
        wrap.innerHTML = '<p class="mto-mat-msg">Loading…</p>';
        const data = await _apiFetch(typicalId);

        if (!data.rows.length) {
            wrap.innerHTML = '<p class="mto-mat-msg">No materials. Click "+ Add Row" to begin.</p>';
            return;
        }
        _render(wrap, typicalId, data.rows);
    }

    return { load, getActiveDrag: () => _activeDrag };
})();
