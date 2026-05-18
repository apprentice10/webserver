/* MTO shell — tab bar and page switching for Typical Assembly engine. */
const MtoShell = (() => {
    let _toolId = null;
    let _db = null;
    let _typicals = [];
    let _activeId = null;
    let _gridInitialized = false;
    let _panelSystemInitialized = false;

    // ── DOM refs ────────────────────────────────────────────────────────

    function _tabBar()  { return document.getElementById('mto-tab-bar'); }
    function _pages()   { return document.getElementById('mto-pages'); }
    function _empty()   { return document.getElementById('mto-empty'); }
    function _toolName(){ return document.getElementById('mto-tool-name'); }

    // ── Fetch ───────────────────────────────────────────────────────────

    function _dbParam() { return `db=${encodeURIComponent(_db)}`; }

    async function _fetchTypicals() {
        const res = await fetch(`/api/engines/mto/${_toolId}/typicals?${_dbParam()}`);
        if (!res.ok) throw new Error(`Failed to load typicals: ${res.status}`);
        return res.json();
    }

    async function _fetchToolName() {
        const res = await fetch(`/api/engines/mto/${_toolId}?${_dbParam()}`);
        if (!res.ok) return;
        const data = await res.json();
        const el = _toolName();
        if (el && data.name) el.textContent = data.name;
    }

    // ── Context menu (singleton) ─────────────────────────────────────────

    let _ctxMenu = null;
    let _ctxTypicalId = null;

    function _ensureContextMenu() {
        if (_ctxMenu) return;
        _ctxMenu = document.createElement('div');
        _ctxMenu.className = 'mto-context-menu';
        _ctxMenu.innerHTML =
            '<button class="danger" data-action="delete">Delete typical…</button>';
        document.body.appendChild(_ctxMenu);
        _ctxMenu.addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (action === 'delete') _deleteTypical(_ctxTypicalId);
            _hideContextMenu();
        });
        document.addEventListener('click', _hideContextMenu, true);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') _hideContextMenu();
        });
    }

    function _showContextMenu(x, y, typicalId) {
        _ensureContextMenu();
        _ctxTypicalId = typicalId;
        _ctxMenu.style.left = `${x}px`;
        _ctxMenu.style.top  = `${y}px`;
        _ctxMenu.style.display = 'block';
    }

    function _hideContextMenu() {
        if (_ctxMenu) _ctxMenu.style.display = 'none';
    }

    // ── CRUD ────────────────────────────────────────────────────────────

    async function _createTypical() {
        const res = await fetch(
            `/api/engines/mto/${_toolId}/typicals?${_dbParam()}`,
            { method: 'POST' }
        );
        if (!res.ok) { alert('Failed to create typical'); return; }
        const t = await res.json();
        _typicals.push(t);
        _activeId = t.id;
        _renderTabBar();
        _renderPages();
        _updateEmptyState();
        // auto-start rename on the new tab
        const btn = _tabBar().querySelector(`[data-typical-id="${t.id}"]`);
        if (btn) _startRename(btn, t);
    }

    async function _saveRename(typicalId, name) {
        const res = await fetch(
            `/api/engines/mto/${_toolId}/typicals/${typicalId}?${_dbParam()}`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            }
        );
        if (!res.ok) { alert('Failed to rename typical'); return; }
        const updated = await res.json();
        const t = _typicals.find(x => x.id === typicalId);
        if (t) t.name = updated.name;
        _renderTabBar();
        _renderPages();
    }

    async function _deleteTypical(typicalId) {
        const t = _typicals.find(x => x.id === typicalId);
        const label = t ? t.name : `#${typicalId}`;
        if (!confirm(`Delete typical "${label}"? This cannot be undone.`)) return;
        const res = await fetch(
            `/api/engines/mto/${_toolId}/typicals/${typicalId}?${_dbParam()}`,
            { method: 'DELETE' }
        );
        if (!res.ok) { alert('Failed to delete typical'); return; }
        _typicals = _typicals.filter(x => x.id !== typicalId);
        if (_activeId === typicalId) {
            _activeId = _typicals.length ? _typicals[0].id : null;
        }
        _renderTabBar();
        _renderPages();
        _updateEmptyState();
    }

    // ── Rename inline ────────────────────────────────────────────────────

    function _startRename(btn, t) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = t.name;
        input.className = 'mto-tab-rename-input';
        btn.replaceWith(input);
        input.select();

        let committed = false;

        function commit() {
            if (committed) return;
            committed = true;
            const newName = input.value.trim();
            if (newName && newName !== t.name) {
                _saveRename(t.id, newName);
            } else {
                _renderTabBar();
            }
        }

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { committed = true; _renderTabBar(); }
        });
    }

    // ── Render ──────────────────────────────────────────────────────────

    function _renderTabBar() {
        const bar = _tabBar();
        bar.innerHTML = '';
        _typicals.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'mto-tab' + (t.id === _activeId ? ' active' : '');
            btn.textContent = t.name;
            btn.dataset.typicalId = t.id;
            btn.addEventListener('click', () => _switchTab(t.id));
            btn.addEventListener('dblclick', e => { e.preventDefault(); _startRename(btn, t); });
            btn.addEventListener('contextmenu', e => {
                e.preventDefault();
                _showContextMenu(e.clientX, e.clientY, t.id);
            });
            bar.appendChild(btn);
        });

        // + button
        const addBtn = document.createElement('button');
        addBtn.className = 'mto-tab-add';
        addBtn.title = 'Add typical';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', _createTypical);
        bar.appendChild(addBtn);
    }

    function _renderPages() {
        const container = _pages();
        container.innerHTML = '';
        _typicals.forEach(t => {
            const div = document.createElement('div');
            div.className = 'mto-page';
            div.id = `mto-page-${t.id}`;
            div.style.display = t.id === _activeId ? '' : 'none';
            div.innerHTML =
                '<div class="mto-image-panel"></div>' +
                '<div class="mto-content-panel">' +
                '<section class="mto-utilities-section">' +
                '<h3 class="mto-utilities-title">Utilities</h3>' +
                '<div class="mto-utilities-wrap"></div>' +
                '</section>' +
                '</div>';
            container.appendChild(div);
        });
        if (_activeId) {
            _loadUtilities(_activeId);
            _loadImage(_activeId);
            _loadMaterials(_activeId);
        }
    }

    // ── Utilities fetch + render ─────────────────────────────────────────

    async function _fetchUtilities(typicalName) {
        const res = await fetch(
            `/api/engines/mto/${_toolId}/utilities?typical_name=${encodeURIComponent(typicalName)}&${_dbParam()}`
        );
        if (!res.ok) return { columns: [], rows: [] };
        return res.json();
    }

    async function _loadMaterials(typicalId) {
        const endpointBase = `/api/engines/mto/${_toolId}/materials/${typicalId}`;
        window._mtoGridEndpointBase = endpointBase;

        const section = document.getElementById('mto-materials-section');
        if (section) section.style.display = '';

        try {
            if (!_gridInitialized) {
                _gridInitialized = true;
                if (!_panelSystemInitialized) {
                    _panelSystemInitialized = true;
                    PanelSystem.init();
                }
                await GridManager.init({ endpointBase });
            } else {
                ApiClient.configure({ endpointBase });
                await GridManager.reloadData();
            }
        } catch (err) {
            console.error('[MtoShell] materials grid error:', err);
        }
    }

    function _loadImage(typicalId) {
        const pageDiv = document.getElementById(`mto-page-${typicalId}`);
        if (!pageDiv) return;
        const panel = pageDiv.querySelector('.mto-image-panel');
        if (!panel) return;
        MtoImage.load(_toolId, typicalId, _db, panel).catch(err =>
            console.error('[MtoShell] image load error:', err)
        );
    }

    async function _loadUtilities(typicalId) {
        const t = _typicals.find(x => x.id === typicalId);
        if (!t) return;
        const pageDiv = document.getElementById(`mto-page-${typicalId}`);
        if (!pageDiv) return;
        const wrap = pageDiv.querySelector('.mto-utilities-wrap');
        if (!wrap) return;
        wrap.innerHTML = '<p class="mto-utilities-loading">Loading…</p>';
        const data = await _fetchUtilities(t.name);
        _renderUtilitiesTable(wrap, data);
    }

    function _renderUtilitiesTable(wrap, data) {
        if (!data.columns.length) {
            wrap.innerHTML = '<p class="mto-utilities-empty">No utilities data. Run ETL to populate.</p>';
            return;
        }
        const headers = data.columns.map(c => `<th>${_esc(c.toUpperCase())}</th>`).join('');
        const bodyRows = data.rows.length
            ? data.rows.map(r =>
                `<tr>${data.columns.map(c => `<td>${_esc(r[c] ?? '')}</td>`).join('')}</tr>`
              ).join('')
            : `<tr><td colspan="${data.columns.length}" class="mto-utilities-empty-cell">No rows</td></tr>`;
        wrap.innerHTML =
            `<table class="mto-utilities-table"><thead><tr>${headers}</tr></thead>` +
            `<tbody>${bodyRows}</tbody></table>`;
    }

    function _esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _updateEmptyState() {
        const empty = _empty();
        const pagesEl = _pages();
        const section = document.getElementById('mto-materials-section');
        const has = _typicals.length > 0;
        if (empty) empty.style.display = has ? 'none' : '';
        if (pagesEl) pagesEl.style.display = has ? '' : 'none';
        if (section && !has) section.style.display = 'none';
    }

    // ── Tab switch ──────────────────────────────────────────────────────

    function _switchTab(typicalId) {
        _activeId = typicalId;
        _tabBar().querySelectorAll('.mto-tab').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.typicalId) === typicalId);
        });
        _pages().querySelectorAll('.mto-page').forEach(div => {
            div.style.display = div.id === `mto-page-${typicalId}` ? '' : 'none';
        });
        _loadUtilities(typicalId);
        _loadImage(typicalId);
        _loadMaterials(typicalId);
    }

    // ── ETL run ─────────────────────────────────────────────────────────

    async function _runEtl() {
        const btn = document.getElementById('btn-run-etl');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
        try {
            const res = await fetch(
                `/api/engines/${_toolId}/etl/run?${_dbParam()}`,
                { method: 'POST' }
            );
            const data = await res.json();
            if (!res.ok) {
                const msg = data.detail || 'ETL run failed';
                if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
                else alert(msg);
                return;
            }
            const added = data.new_typicals ? data.new_typicals.length : 0;
            const msg = added
                ? `ETL: ${data.rows_written} rows written, ${added} new typical(s) added`
                : `ETL: ${data.rows_written} rows written`;
            if (typeof Utils !== 'undefined') Utils.showToast(msg, 'success');
            await reloadTabs();
        } catch (err) {
            if (typeof Utils !== 'undefined') Utils.showToast('ETL run error: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '▶ Run ETL'; }
        }
    }

    // ── Public: reload tab bar (called after ETL apply in Step 6) ───────

    async function reloadTabs() {
        _typicals = await _fetchTypicals();
        if (!_typicals.find(t => t.id === _activeId)) {
            _activeId = _typicals.length ? _typicals[0].id : null;
        }
        _gridInitialized = false;  // force full re-init on next load
        _renderTabBar();
        _renderPages();
        _updateEmptyState();
    }

    // ── Init ────────────────────────────────────────────────────────────

    async function _init() {
        _toolId = window.MTO_TOOL;
        _db = window.MTO_DB;

        const runBtn = document.getElementById('btn-run-etl');
        if (runBtn) runBtn.addEventListener('click', _runEtl);

        await _fetchToolName();
        _typicals = await _fetchTypicals();
        _activeId = _typicals.length ? _typicals[0].id : null;

        _updateEmptyState();
        _renderTabBar();
        _renderPages();
    }

    document.addEventListener('DOMContentLoaded', () => {
        _init().catch(err => console.error('[MtoShell] init error:', err));
    });

    return { reloadTabs };
})();
