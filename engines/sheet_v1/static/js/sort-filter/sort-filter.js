/**
 * sort-filter.js — Sheet V1
 * Client-side sort & filter on the full in-memory row array.
 * Sort: multi-level, bidirectional with column header click.
 * Filter: per-column checkbox list + wildcard OR terms.
 * State persisted to DB via sort-filter-state endpoint.
 */

const SortFilterManager = (() => {

    let _sortLevels    = [];
    let _columnFilters = {};
    let _filterDropdown   = null;
    let _persistTimer     = null;
    let _outsideClick     = null;
    let _outsideKey       = null;

    // ── State ─────────────────────────────────────────────────

    function loadState(s) {
        if (!s) return;
        _sortLevels    = Array.isArray(s.sort)                         ? s.sort    : [];
        _columnFilters = (s.filters && typeof s.filters === 'object')  ? s.filters : {};
    }
    function getState() { return { sort: _sortLevels, filters: _columnFilters }; }
    function persistState() {
        clearTimeout(_persistTimer);
        _persistTimer = setTimeout(() => ApiClient.setSortFilterState(getState()).catch(() => {}), 500);
    }

    // ── Apply ─────────────────────────────────────────────────

    function applyToRows(rows) { return _sortRows(_filterRows(rows)); }

    function _matchWildcard(value, pattern) {
        const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        return re.test(value);
    }

    function _filterRows(rows) {
        const active = Object.entries(_columnFilters).filter(([, t]) => t && t.length);
        if (!active.length) return rows;
        return rows.filter(row => active.every(([slug, terms]) => {
            const val = String(row[slug] ?? '');
            return terms.some(t => t.type === 'values' ? t.values.includes(val) : _matchWildcard(val, t.pattern || ''));
        }));
    }

    function _sortRows(rows) {
        if (!_sortLevels.length) return rows;
        return [...rows].sort((a, b) => {
            for (const { col_slug, dir } of _sortLevels) {
                const cmp = String(a[col_slug] ?? '').localeCompare(String(b[col_slug] ?? ''), undefined, { numeric: true, sensitivity: 'base' });
                if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
            }
            return 0;
        });
    }

    // ── Sort API ──────────────────────────────────────────────

    function getSortDir(slug)   { return _sortLevels.find(l => l.col_slug === slug)?.dir || null; }
    function getSortIndex(slug) { const i = _sortLevels.findIndex(l => l.col_slug === slug); return i === -1 ? null : i + 1; }

    function setSortLevel(slug) {
        const idx = _sortLevels.findIndex(l => l.col_slug === slug);
        if (idx === -1)                          _sortLevels.push({ col_slug: slug, dir: 'asc' });
        else if (_sortLevels[idx].dir === 'asc') _sortLevels[idx].dir = 'desc';
        else                                     _sortLevels.splice(idx, 1);
        persistState(); _updateHeaderSortIndicators(); _refreshSortPanel();
    }

    function clearAllSort() { _sortLevels = []; persistState(); _updateHeaderSortIndicators(); _refreshSortPanel(); }

    // ── Filter API ────────────────────────────────────────────

    function isFilterActive(slug)           { return !!(_columnFilters[slug]?.length); }
    function getFilterTerms(slug)           { return _columnFilters[slug] || []; }

    function setColumnFilter(slug, terms) {
        if (!terms || !terms.length) delete _columnFilters[slug]; else _columnFilters[slug] = terms;
        persistState(); _updateHeaderFilterIndicators();
    }
    function clearColumnFilter(slug)  { delete _columnFilters[slug]; persistState(); _updateHeaderFilterIndicators(); }
    function clearAll()               {
        _sortLevels = []; _columnFilters = {};
        persistState(); _updateHeaderSortIndicators(); _updateHeaderFilterIndicators(); _refreshSortPanel();
    }

    // ── Header indicators ─────────────────────────────────────

    function _updateHeaderSortIndicators() {
        document.querySelectorAll('th[data-slug]').forEach(th => {
            const dir = getSortDir(th.dataset.slug), rank = getSortIndex(th.dataset.slug);
            const arrow = th.querySelector('.th-sort-arrow'), badge = th.querySelector('.th-sort-badge');
            if (arrow) { arrow.textContent = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : ''; arrow.classList.toggle('sf-sort-active', !!dir); }
            if (badge) { const m = _sortLevels.length > 1; badge.textContent = m && rank ? rank : ''; badge.style.display = m && rank ? '' : 'none'; }
        });
    }
    function _updateHeaderFilterIndicators() {
        document.querySelectorAll('th[data-slug]').forEach(th => {
            const btn = th.querySelector('.th-filter-btn');
            if (btn) btn.classList.toggle('sf-filter-active', isFilterActive(th.dataset.slug));
        });
    }
    function updateHeaderIndicators() { _updateHeaderSortIndicators(); _updateHeaderFilterIndicators(); }

    // ── Filter dropdown ───────────────────────────────────────

    function openFilterDropdown(slug, anchorEl, allRows) {
        closeFilterDropdown();
        const col     = ColumnsManager.getColumns().find(c => c.slug === slug);
        const uniq    = [...new Set(allRows.map(r => String(r[slug] ?? '')))].sort();
        const terms   = getFilterTerms(slug);
        const valTerm = terms.find(t => t.type === 'values');
        const checked = valTerm ? valTerm.values : [...uniq];
        const pats    = terms.filter(t => t.type === 'pattern');

        const dd = document.createElement('div');
        dd.className = 'sf-filter-dropdown';
        const allChk = checked.length === uniq.length;
        const cbRows = uniq.map(v => `<label class="sf-cb-row"><input type="checkbox" value="${Utils.escAttr(v)}" ${checked.includes(v) ? 'checked' : ''}>${v === '' ? '<em>(empty)</em>' : Utils.escHtml(v)}</label>`).join('');
        const patRows = pats.map(p => `<div class="sf-pat-row"><input class="sf-pat-input" type="text" value="${Utils.escAttr(p.pattern)}" placeholder="e.g. TT-*"><button class="sf-rm-pat" title="Remove">✕</button></div>`).join('');
        dd.innerHTML = `<div class="sf-dd-head"><span class="sf-dd-title">${Utils.escHtml(col ? col.name : slug)}</span><input class="sf-dd-search" type="text" placeholder="Search…"><label class="sf-cb-row sf-cb-all"><input type="checkbox" id="sf-cb-all" ${allChk ? 'checked' : ''}> Select all</label></div><div class="sf-cb-list">${cbRows || '<p class="sf-empty-msg">No values</p>'}</div><div class="sf-pat-list">${patRows}</div><div class="sf-dd-foot"><button class="sf-btn-add-pat btn btn-ghost btn-sm">+ Wildcard</button><div class="sf-dd-actions"><button class="sf-btn-clear btn btn-ghost btn-sm">Clear</button><button class="sf-btn-apply btn btn-sm">Apply</button></div></div>`;
        document.body.appendChild(dd);

        const r = anchorEl.getBoundingClientRect();
        dd.style.cssText = `position:fixed;top:${r.bottom + 2}px;left:${r.left}px`;
        requestAnimationFrame(() => {
            const dr = dd.getBoundingClientRect();
            if (dr.right  > window.innerWidth  - 8) dd.style.left = (window.innerWidth  - dr.width  - 8) + 'px';
            if (dr.bottom > window.innerHeight - 8) dd.style.top  = (r.top - dr.height - 2) + 'px';
        });
        _filterDropdown = dd;
        _attachDropdownEvents(dd, slug, uniq);
    }

    function _attachDropdownEvents(dd, slug, uniq) {
        const search = dd.querySelector('.sf-dd-search'), cbList = dd.querySelector('.sf-cb-list');
        const allCb  = dd.querySelector('#sf-cb-all'),   patList = dd.querySelector('.sf-pat-list');

        search.addEventListener('input', () => {
            const q = search.value.toLowerCase();
            cbList.querySelectorAll('.sf-cb-row').forEach(r => { r.style.display = r.querySelector('input').value.toLowerCase().includes(q) ? '' : 'none'; });
        });
        if (allCb) allCb.addEventListener('change', () => cbList.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = allCb.checked; }));

        dd.querySelector('.sf-btn-add-pat').addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'sf-pat-row';
            row.innerHTML = `<input class="sf-pat-input" type="text" placeholder="e.g. TT-*"><button class="sf-rm-pat" title="Remove">✕</button>`;
            row.querySelector('.sf-rm-pat').addEventListener('click', () => row.remove());
            patList.appendChild(row);
            row.querySelector('input').focus();
        });
        patList.addEventListener('click', e => { const b = e.target.closest('.sf-rm-pat'); if (b) b.closest('.sf-pat-row').remove(); });

        dd.querySelector('.sf-btn-clear').addEventListener('click', () => { clearColumnFilter(slug); closeFilterDropdown(); GridManager.applySort(); });
        dd.querySelector('.sf-btn-apply').addEventListener('click', () => {
            const vals  = [...dd.querySelectorAll('.sf-cb-list input[type=checkbox]:checked')].map(cb => cb.value);
            const terms = [];
            if (vals.length !== uniq.length) terms.push({ type: 'values', values: vals });
            dd.querySelectorAll('.sf-pat-input').forEach(inp => { const p = inp.value.trim(); if (p) terms.push({ type: 'pattern', pattern: p }); });
            setColumnFilter(slug, terms);
            closeFilterDropdown();
            GridManager.applySort();
        });

        _outsideClick = e => { if (!dd.contains(e.target) && !e.target.closest('.th-filter-btn')) closeFilterDropdown(); };
        _outsideKey   = e => { if (e.key === 'Escape') closeFilterDropdown(); };
        setTimeout(() => { document.addEventListener('mousedown', _outsideClick); document.addEventListener('keydown', _outsideKey); }, 10);
    }

    function closeFilterDropdown() {
        if (_filterDropdown)  { _filterDropdown.remove(); _filterDropdown = null; }
        if (_outsideClick)    { document.removeEventListener('mousedown', _outsideClick); _outsideClick = null; }
        if (_outsideKey)      { document.removeEventListener('keydown',   _outsideKey);   _outsideKey   = null; }
    }

    // ── Header event delegation ───────────────────────────────

    function attachHeaderListeners() {
        const hdr = document.getElementById('grid-header-row');
        if (!hdr || hdr.dataset.sfInit) return;
        hdr.dataset.sfInit = '1';
        hdr.addEventListener('click', e => {
            const filterBtn = e.target.closest('.th-filter-btn');
            if (filterBtn) {
                e.stopPropagation();
                openFilterDropdown(filterBtn.dataset.slug, filterBtn, GridManager.getAllRows().filter(r => !r.is_deleted));
                return;
            }
            const label = e.target.closest('.th-sortable');
            if (label && label.dataset.slug) { setSortLevel(label.dataset.slug); GridManager.applySort(); }
        });
    }

    // ── Sort panel ────────────────────────────────────────────

    function registerPanel() {
        PanelSystem.register({ id: 'sort-filter', title: 'Sort & Filter', onActivate: body => { body.innerHTML = _renderPanel(); _attachPanelEvents(body); } });
    }

    function _refreshSortPanel() {
        if (!PanelSystem.isPanelOpen('sort-filter')) return;
        const body = PanelSystem.getPanelBody('sort-filter');
        if (body) { body.innerHTML = _renderPanel(); _attachPanelEvents(body); }
    }

    function _renderPanel() {
        const userCols = ColumnsManager.getColumns().filter(c => !c.is_system);
        const mkOpts   = (sel) => userCols.map(c => `<option value="${Utils.escAttr(c.slug)}" ${c.slug === sel ? 'selected' : ''}>${Utils.escHtml(c.name)}</option>`).join('');

        const levels = _sortLevels.map((lv, i) => `<div class="sf-panel-level" data-idx="${i}"><span class="sf-lvl-num">${i + 1}</span><select class="sf-lvl-col">${mkOpts(lv.col_slug)}</select><select class="sf-lvl-dir"><option value="asc" ${lv.dir==='asc'?'selected':''}>↑ Ascending</option><option value="desc" ${lv.dir==='desc'?'selected':''}>↓ Descending</option></select><button class="sf-rm-level btn btn-ghost btn-sm" data-idx="${i}">✕</button></div>`).join('')
            || '<p class="sf-panel-empty">No sort levels. Click a column header to add.</p>';

        const active = Object.keys(_columnFilters).filter(s => _columnFilters[s]?.length);
        const chips  = active.length
            ? active.map(s => { const c = ColumnsManager.getColumns().find(x => x.slug === s); return `<span class="sf-filter-chip">${Utils.escHtml(c ? c.name : s)} <button class="sf-rm-filter" data-slug="${Utils.escAttr(s)}">✕</button></span>`; }).join('')
            : '<span class="sf-panel-empty">No active filters.</span>';

        return `<div class="sf-panel"><h4 class="sf-panel-title">Sort levels</h4><div class="sf-panel-levels">${levels}</div><div class="sf-panel-add"><select class="sf-add-col-sel">${mkOpts('')}</select><button class="sf-btn-add-level btn btn-ghost btn-sm">+ Add level</button><button class="sf-btn-clear-sort btn btn-ghost btn-sm">Clear sort</button></div><h4 class="sf-panel-title">Active filters</h4><div class="sf-filter-chips">${chips}</div><div class="sf-panel-actions"><button class="sf-btn-clear-all btn btn-ghost btn-sm">Clear all</button></div></div>`;
    }

    function _attachPanelEvents(body) {
        body.querySelectorAll('.sf-panel-level').forEach(row => {
            const i = parseInt(row.dataset.idx);
            row.querySelector('.sf-lvl-col').addEventListener('change', e => { _sortLevels[i].col_slug = e.target.value; persistState(); _updateHeaderSortIndicators(); GridManager.applySort(); });
            row.querySelector('.sf-lvl-dir').addEventListener('change', e => { _sortLevels[i].dir = e.target.value; persistState(); _updateHeaderSortIndicators(); GridManager.applySort(); });
        });
        body.querySelectorAll('.sf-rm-level').forEach(btn => btn.addEventListener('click', () => {
            _sortLevels.splice(parseInt(btn.dataset.idx), 1); persistState(); _updateHeaderSortIndicators(); _refreshSortPanel(); GridManager.applySort();
        }));
        body.querySelector('.sf-btn-add-level')?.addEventListener('click', () => {
            const slug = body.querySelector('.sf-add-col-sel')?.value;
            if (!slug || _sortLevels.find(l => l.col_slug === slug)) return;
            _sortLevels.push({ col_slug: slug, dir: 'asc' }); persistState(); _updateHeaderSortIndicators(); _refreshSortPanel(); GridManager.applySort();
        });
        body.querySelector('.sf-btn-clear-sort')?.addEventListener('click', () => { clearAllSort(); GridManager.applySort(); });
        body.querySelectorAll('.sf-rm-filter').forEach(btn => btn.addEventListener('click', () => { clearColumnFilter(btn.dataset.slug); _refreshSortPanel(); GridManager.applySort(); }));
        body.querySelector('.sf-btn-clear-all')?.addEventListener('click', () => { clearAll(); GridManager.applySort(); });
    }

    // ── Public API ────────────────────────────────────────────

    return {
        loadState, getState, persistState, applyToRows,
        getSortDir, getSortIndex, setSortLevel, clearAllSort,
        isFilterActive, getFilterTerms, setColumnFilter, clearColumnFilter, clearAll,
        openFilterDropdown, closeFilterDropdown,
        updateHeaderIndicators, attachHeaderListeners, registerPanel,
    };

})();
