/* MTO export dialog — modal for exporting typicals to an external project DB. */
const MtoExport = (() => {
    let _modal = null;
    let _toolId = null;
    let _db = null;
    // null = not yet checked, [] = no conflicts, [{name,id,mode,newName}] = pending conflicts
    let _conflictItems = null;

    function _dbParam() { return `db=${encodeURIComponent(_db)}`; }

    function _esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Modal DOM ────────────────────────────────────────────────────────

    function _buildModal() {
        const overlay = document.createElement('div');
        overlay.className = 'mto-export-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'mto-export-dialog';
        dialog.innerHTML =
            '<div class="mto-export-header">' +
                '<span class="mto-export-title">Export Typicals</span>' +
                '<button class="mto-export-close" title="Close">&#x2715;</button>' +
            '</div>' +
            '<div class="mto-export-dest-row">' +
                '<label class="mto-export-label">Destination DB</label>' +
                '<input type="text" class="mto-export-path-input" placeholder="Path to destination .db file…">' +
            '</div>' +
            '<div class="mto-export-list-header">' +
                '<label class="mto-export-label">Typicals to export</label>' +
                '<button class="mto-export-toggle-all btn btn-sm btn-ghost">Select all</button>' +
            '</div>' +
            '<div class="mto-export-list"></div>' +
            '<div class="mto-export-conflicts"></div>' +
            '<div class="mto-export-footer">' +
                '<button class="mto-export-btn btn btn-sm btn-primary">Export</button>' +
                '<button class="mto-export-cancel btn btn-sm btn-ghost">Cancel</button>' +
            '</div>';

        overlay.appendChild(dialog);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) close();
        });
        dialog.querySelector('.mto-export-close').addEventListener('click', close);
        dialog.querySelector('.mto-export-cancel').addEventListener('click', close);
        dialog.querySelector('.mto-export-toggle-all').addEventListener('click', _toggleAll);
        dialog.querySelector('.mto-export-btn').addEventListener('click', _doExport);
        dialog.querySelector('.mto-export-path-input').addEventListener('input', _resetConflicts);

        document.body.appendChild(overlay);
        return overlay;
    }

    // ── Load and render typicals ────────────────────────────────────────

    async function _loadTypicals() {
        const listEl = _modal.querySelector('.mto-export-list');
        listEl.innerHTML = '<p class="mto-export-msg">Loading…</p>';
        try {
            const res = await fetch(
                `/api/engines/mto/${_toolId}/typicals?${_dbParam()}`
            );
            const data = await res.json();
            if (!res.ok) {
                listEl.innerHTML =
                    `<p class="mto-export-error">${_esc(data.detail || 'Error loading typicals')}</p>`;
                return;
            }
            _renderList(listEl, data.typicals || data);
        } catch (err) {
            listEl.innerHTML = `<p class="mto-export-error">${_esc(err.message)}</p>`;
        }
    }

    function _renderList(listEl, typicals) {
        if (!typicals.length) {
            listEl.innerHTML = '<p class="mto-export-msg">No typicals in this tool.</p>';
            return;
        }
        listEl.innerHTML = '';
        typicals.forEach(t => {
            const row = document.createElement('label');
            row.className = 'mto-export-row';
            row.innerHTML =
                `<input type="checkbox" class="mto-export-check" data-id="${t.id}" data-name="${_esc(t.name)}" checked>` +
                `<span class="mto-export-row-name">${_esc(t.name)}</span>`;
            listEl.appendChild(row);
        });
        _syncToggleLabel();
        listEl.querySelectorAll('.mto-export-check').forEach(cb =>
            cb.addEventListener('change', () => { _syncToggleLabel(); _resetConflicts(); })
        );
    }

    function _syncToggleLabel() {
        const checks = _modal.querySelectorAll('.mto-export-check');
        const allChecked = [...checks].every(c => c.checked);
        const btn = _modal.querySelector('.mto-export-toggle-all');
        btn.textContent = allChecked ? 'Deselect all' : 'Select all';
    }

    function _toggleAll() {
        const checks = [..._modal.querySelectorAll('.mto-export-check')];
        const allChecked = checks.every(c => c.checked);
        checks.forEach(c => { c.checked = !allChecked; });
        _syncToggleLabel();
        _resetConflicts();
    }

    // ── Conflict resolution ──────────────────────────────────────────────

    function _resetConflicts() {
        _conflictItems = null;
        const section = _modal.querySelector('.mto-export-conflicts');
        if (section) section.innerHTML = '';
        _updateExportBtn();
    }

    function _allResolved() {
        if (!_conflictItems || !_conflictItems.length) return true;
        return _conflictItems.every(c =>
            c.mode === 'overwrite' || (c.mode === 'rename' && c.newName.length > 0)
        );
    }

    function _updateExportBtn() {
        const btn = _modal.querySelector('.mto-export-btn');
        if (!btn) return;
        const hasUnresolved = _conflictItems && _conflictItems.length && !_allResolved();
        btn.disabled = hasUnresolved;
        btn.textContent = (_conflictItems && _conflictItems.length && _allResolved())
            ? 'Confirm Export'
            : 'Export';
    }

    function _renderConflicts(conflicts, checked) {
        const section = _modal.querySelector('.mto-export-conflicts');
        section.innerHTML = '';

        if (!conflicts.length) {
            _conflictItems = [];
            _updateExportBtn();
            return;
        }

        const nameToId = {};
        checked.forEach(c => { nameToId[c.dataset.name] = c.dataset.id; });

        _conflictItems = conflicts.map(name => ({
            name,
            id: nameToId[name] || null,
            mode: 'overwrite',
            newName: '',
        }));

        const heading = document.createElement('p');
        heading.className = 'mto-export-conflict-heading';
        heading.textContent =
            `${conflicts.length} name conflict${conflicts.length > 1 ? 's' : ''} in destination — resolve before exporting:`;
        section.appendChild(heading);

        _conflictItems.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'mto-export-conflict-row';
            row.innerHTML =
                `<span class="mto-export-conflict-name">${_esc(item.name)}</span>` +
                '<div class="mto-export-conflict-actions">' +
                    `<label class="mto-export-conflict-opt"><input type="radio" name="conf-${idx}" value="overwrite" checked> Overwrite</label>` +
                    `<label class="mto-export-conflict-opt"><input type="radio" name="conf-${idx}" value="rename"> Rename to:</label>` +
                    '<input type="text" class="mto-export-conflict-input" placeholder="New name…" disabled>' +
                '</div>';

            const radios = row.querySelectorAll('input[type="radio"]');
            const nameInput = row.querySelector('.mto-export-conflict-input');

            radios.forEach(r => {
                r.addEventListener('change', () => {
                    const isRename = r.value === 'rename' && r.checked;
                    nameInput.disabled = !isRename;
                    item.mode = isRename ? 'rename' : 'overwrite';
                    if (!isRename) { item.newName = ''; nameInput.value = ''; }
                    else nameInput.focus();
                    _updateExportBtn();
                });
            });

            nameInput.addEventListener('input', () => {
                item.newName = nameInput.value.trim();
                _updateExportBtn();
            });

            section.appendChild(row);
        });

        _updateExportBtn();
    }

    // ── Export ───────────────────────────────────────────────────────────

    async function _doExport() {
        const destPath = _modal.querySelector('.mto-export-path-input').value.trim();
        if (!destPath) {
            if (typeof Utils !== 'undefined') Utils.showToast('Enter a destination DB path.', 'error');
            else alert('Enter a destination DB path.');
            return;
        }
        const checked = [..._modal.querySelectorAll('.mto-export-check:checked')];
        if (!checked.length) {
            if (typeof Utils !== 'undefined') Utils.showToast('Select at least one typical to export.', 'error');
            else alert('Select at least one typical to export.');
            return;
        }

        // Phase 1: conflict check not yet done
        if (_conflictItems === null) {
            await _runConflictCheck(destPath, checked);
            return;
        }

        // Phase 2: conflicts exist but not all resolved (button should be disabled — guard anyway)
        if (_conflictItems.length && !_allResolved()) return;

        // Phase 3: no conflicts or all resolved → execute
        const renameMap = {};
        _conflictItems.forEach(c => {
            if (c.mode === 'rename' && c.id) renameMap[String(c.id)] = c.newName;
        });
        await _executeExport(checked.map(c => parseInt(c.dataset.id)), destPath, renameMap);
    }

    async function _runConflictCheck(destPath, checked) {
        const exportBtn = _modal.querySelector('.mto-export-btn');
        exportBtn.disabled = true;
        exportBtn.textContent = 'Checking…';
        try {
            const params = new URLSearchParams({ dest_db_path: destPath });
            checked.forEach(c => params.append('names', c.dataset.name));
            const res = await fetch(`/api/engines/mto/export/check?${params}`);
            const data = await res.json();
            if (!res.ok) {
                const msg = data.detail || 'Conflict check failed';
                if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
                else alert(msg);
                exportBtn.disabled = false;
                exportBtn.textContent = 'Export';
                return;
            }
            _renderConflicts(data.conflicts, checked);
            if (!data.conflicts.length) {
                // No conflicts → execute immediately
                const renameMap = {};
                await _executeExport(checked.map(c => parseInt(c.dataset.id)), destPath, renameMap);
            }
        } catch (err) {
            if (typeof Utils !== 'undefined') Utils.showToast('Conflict check error: ' + err.message, 'error');
            else alert('Conflict check error: ' + err.message);
            exportBtn.disabled = false;
            exportBtn.textContent = 'Export';
        }
    }

    async function _executeExport(typicalIds, destPath, renameMap) {
        const exportBtn = _modal.querySelector('.mto-export-btn');
        exportBtn.disabled = true;
        exportBtn.textContent = 'Exporting…';
        try {
            const res = await fetch(
                `/api/engines/mto/${_toolId}/export?${_dbParam()}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        dest_db_path: destPath,
                        typical_ids: typicalIds,
                        conflict_strategy: 'overwrite',
                        rename_map: renameMap,
                    }),
                }
            );
            const data = await res.json();
            if (!res.ok) {
                const msg = data.detail || 'Export failed';
                if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
                else alert(msg);
                return;
            }
            const results = data.results || [];
            const failed = results.filter(r => !r.ok);
            if (failed.length) {
                const names = failed.map(r => r.name || r.typical_id).join(', ');
                if (typeof Utils !== 'undefined')
                    Utils.showToast(`Export errors: ${names}`, 'error');
                else alert(`Export errors: ${names}`);
            } else {
                const count = results.length || typicalIds.length;
                if (typeof Utils !== 'undefined')
                    Utils.showToast(`Exported ${count} typical(s) successfully.`, 'success');
                close();
            }
        } catch (err) {
            const msg = 'Export error: ' + err.message;
            if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
            else alert(msg);
        } finally {
            exportBtn.disabled = false;
            _updateExportBtn();
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    function open() {
        _toolId = window.MTO_TOOL;
        _db = window.MTO_DB;
        if (!_modal) _modal = _buildModal();
        _conflictItems = null;
        _modal.querySelector('.mto-export-path-input').value = '';
        _modal.querySelector('.mto-export-conflicts').innerHTML = '';
        _updateExportBtn();
        _modal.classList.add('open');
        _loadTypicals();
    }

    function close() {
        if (_modal) _modal.classList.remove('open');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('btn-export-typical');
        if (btn) btn.addEventListener('click', open);
    });

    return { open, close };
})();
