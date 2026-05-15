const PanelSystem = (() => {
    function _storageKey() {
        if (typeof DB_PATH !== 'undefined' && DB_PATH) {
            let h = 5381;
            for (let i = 0; i < DB_PATH.length; i++) h = (h * 33 ^ DB_PATH.charCodeAt(i)) >>> 0;
            return `im_panels_${h.toString(36)}`;
        }
        return 'instrumentManager.layout.v2';
    }
    const FLOAT_W     = 320;
    const FLOAT_H     = 400;
    const SNAP_DIST   = 48;  // px proximity threshold for K-7
    const _registry   = {};
    let _state        = _loadState();
    // ── State ─────────────────────────────────────────────────

    function _loadState() {
        try {
            const raw = localStorage.getItem(_storageKey());
            if (raw) {
                const s = JSON.parse(raw);
                if (s.version === 4) return s;
                if (s.version === 3) return {
                    ...s, version: 4,
                    bottomDock: { open: false, height: 200, activeTab: null, tabs: [] }
                };
                if (s.version === 2) return {
                    version: 4,
                    rightDock:  { open: false, width: 320, activeTab: null, tabs: [] },
                    bottomDock: { open: false, height: 200, activeTab: null, tabs: [] },
                    floats: []
                };
            }
        } catch (_) {}
        return {
            version: 4,
            rightDock:  { open: false, width: 320, activeTab: null, tabs: [] },
            bottomDock: { open: false, height: 200, activeTab: null, tabs: [] },
            floats: []
        };
    }

    function _saveState() {
        try { localStorage.setItem(_storageKey(), JSON.stringify(_state)); } catch (_) {}
    }

    // ── DOM helpers ───────────────────────────────────────────

    function _getDock()       { return document.getElementById('sidebar-panel'); }
    function _getBody()       { return document.getElementById('sidebar-body'); }
    function _getTitleEl()    { return document.getElementById('sidebar-title'); }
    function _getBottomDock() { return document.getElementById('bottom-dock'); }
    function _getBottomBody() { return document.getElementById('bottom-dock-body'); }

    // ── Layout ────────────────────────────────────────────────

    function _applyLayout() {
        _applyRightDock();
        _applyBottomDock();
        PanelFloats.render();
    }

    function _applyRightDock() {
        const dock = _getDock();
        if (!dock) return;
        const { open, width, tabs, activeTab } = _state.rightDock;
        const isOpen = open && tabs.length > 0;
        dock.classList.toggle('sidebar-closed', !isOpen);
        dock.style.setProperty('--sidebar-width', (width || 320) + 'px');
        PanelTabBar.renderTabBar(tabs, activeTab);
        const titleEl = _getTitleEl();
        if (titleEl && activeTab && _registry[activeTab]) {
            titleEl.textContent = _registry[activeTab].title;
        }
    }

    function _applyBottomDock() {
        const dock = _getBottomDock();
        if (!dock) return;
        const { open, height, tabs, activeTab } = _state.bottomDock;
        const isOpen = open && tabs.length > 0;
        dock.classList.toggle('bottom-dock-closed', !isOpen);
        dock.style.setProperty('--bottom-dock-height', (height || 200) + 'px');
        PanelTabBar.renderBottomTabBar(tabs, activeTab);
        const titleEl = document.getElementById('bottom-dock-title');
        if (titleEl && activeTab && _registry[activeTab]) {
            titleEl.textContent = _registry[activeTab].title;
        }
        const header = dock.querySelector('.bottom-dock-header');
        if (header) header.style.display = isOpen && tabs.length === 1 ? 'flex' : 'none';
    }

    // ── Resize handles ────────────────────────────────────────

    function _initSidebarResize() {
        const handle = document.getElementById('sidebar-resize-handle');
        const dock   = _getDock();
        if (!handle || !dock) return;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = _state.rightDock.width || 320;
            dock.style.transition = 'none';
            handle.classList.add('is-resizing');
            const onMove = ev => {
                // dragging left (cx decreases) → sidebar grows
                const w = Math.max(200, Math.min(600, startW - (ev.clientX - startX)));
                _state.rightDock.width = w;
                dock.style.setProperty('--sidebar-width', w + 'px');
            };
            const onUp = () => {
                dock.style.transition = '';
                handle.classList.remove('is-resizing');
                _saveState();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function _initBottomResize() {
        const handle = document.getElementById('bottom-dock-resize-handle');
        const dock   = _getBottomDock();
        if (!handle || !dock) return;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = _state.bottomDock.open ? (_state.bottomDock.height || 200) : 0;
            dock.style.transition = 'none';
            handle.classList.add('is-resizing');
            const onMove = ev => {
                const h = Math.max(80, Math.min(500, startH - (ev.clientY - startY)));
                _state.bottomDock.height = h;
                dock.style.setProperty('--bottom-dock-height', h + 'px');
                // Re-open if panels exist and user drags up from closed state
                if (!_state.bottomDock.open && _state.bottomDock.tabs.length > 0) {
                    _state.bottomDock.open = true;
                    dock.classList.remove('bottom-dock-closed');
                }
            };
            const onUp = () => {
                dock.style.transition = '';
                handle.classList.remove('is-resizing');
                _saveState();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Public API ────────────────────────────────────────────

    function register(config) { _registry[config.id] = config; }

    function getExtra(key)        { return (_state.extra || {})[key]; }
    function setExtra(key, value) { if (!_state.extra) _state.extra = {}; _state.extra[key] = value; _saveState(); }

    // opts.silent=true: open/activate without calling onActivate (legacy setContent pattern).
    // opts.dock='bottom': open in bottom dock instead of right (only used if panel has no current location).
    function showPanel(id, opts) {
        // Already floating — just refresh content (skip onActivate if silent)
        const floatEntry = (_state.floats || []).find(f => f.id === id);
        if (floatEntry) {
            const floatEl = document.querySelector(`.panel-float[data-panel-id="${id}"]`);
            if (floatEl && _registry[id]?.onActivate && !(opts && opts.silent)) {
                _registry[id].onActivate(floatEl.querySelector('.panel-float-body'));
            }
            return;
        }

        // Panel already in a dock — activate it there regardless of caller's hint
        for (const [dockName, d] of [['right', _state.rightDock], ['bottom', _state.bottomDock]]) {
            if (d.tabs.includes(id)) {
                const wasActive = d.activeTab === id && d.open;
                d.open      = true;
                d.activeTab = id;
                _saveState();
                _applyLayout();
                if (!(opts && opts.silent) && !wasActive) {
                    const panel = _registry[id];
                    const body  = dockName === 'bottom' ? _getBottomBody() : _getBody();
                    if (panel && panel.onActivate && body) panel.onActivate(body);
                }
                return;
            }
        }

        // Panel not currently anywhere — use caller's hint
        const dockName = opts && opts.dock === 'bottom' ? 'bottom' : 'right';
        const d = dockName === 'bottom' ? _state.bottomDock : _state.rightDock;
        d.tabs.push(id);
        d.open      = true;
        d.activeTab = id;
        _saveState();
        _applyLayout();
        if (!(opts && opts.silent)) {
            const panel = _registry[id];
            const body  = dockName === 'bottom' ? _getBottomBody() : _getBody();
            if (panel && panel.onActivate && body) panel.onActivate(body);
        }
    }

    function hidePanel(id) {
        // Float?
        if (_state.floats) {
            const fi = _state.floats.findIndex(f => f.id === id);
            if (fi !== -1) {
                _state.floats.splice(fi, 1);
                _saveState();
                _applyLayout();
                return;
            }
        }
        // Bottom dock?
        const bd = _state.bottomDock;
        if (bd.tabs.includes(id)) {
            const wasActive = bd.activeTab === id;
            bd.tabs = bd.tabs.filter(t => t !== id);
            if (wasActive) bd.activeTab = bd.tabs[bd.tabs.length - 1] || null;
            if (bd.tabs.length === 0) bd.open = false;
            _saveState();
            _applyLayout();
            if (wasActive && bd.activeTab) _refreshDockBody('bottom', bd.activeTab);
            return;
        }
        // Right dock
        const rd = _state.rightDock;
        const wasActive = rd.activeTab === id;
        rd.tabs = rd.tabs.filter(t => t !== id);
        if (wasActive) rd.activeTab = rd.tabs[rd.tabs.length - 1] || null;
        if (rd.tabs.length === 0) rd.open = false;
        _saveState();
        _applyLayout();
        if (wasActive && rd.activeTab) _refreshDockBody('right', rd.activeTab);
    }

    function _refreshDockBody(dockName, id) {
        const panel = _registry[id];
        const body  = dockName === 'bottom' ? _getBottomBody() : _getBody();
        if (panel?.onActivate && body) panel.onActivate(body);
    }

    function moveToFloat(id, x, y) {
        // Remove from whichever dock holds it; track which docks lost their active tab
        const refreshes = [];
        for (const [dockName, d] of [['bottom', _state.bottomDock], ['right', _state.rightDock]]) {
            if (d.tabs.includes(id)) {
                const wasActive = d.activeTab === id;
                d.tabs = d.tabs.filter(t => t !== id);
                if (wasActive) d.activeTab = d.tabs[d.tabs.length - 1] || null;
                if (d.tabs.length === 0) d.open = false;
                if (wasActive && d.activeTab) refreshes.push([dockName, d.activeTab]);
            }
        }
        if (!_state.floats) _state.floats = [];
        if (!_state.floats.find(f => f.id === id)) {
            _state.floats.push({ id, x, y, w: FLOAT_W, h: FLOAT_H });
        }
        _saveState();
        _applyLayout();
        for (const [dockName, newId] of refreshes) _refreshDockBody(dockName, newId);
    }

    // target: 'right' (default) | 'bottom'
    function dockPanel(id, target) {
        target = target || 'right';
        if (_state.floats) {
            const fi = _state.floats.findIndex(f => f.id === id);
            if (fi !== -1) _state.floats.splice(fi, 1);
        }
        // Remove from the other dock if present
        const other = target === 'bottom' ? _state.rightDock : _state.bottomDock;
        if (other.tabs.includes(id)) {
            other.tabs = other.tabs.filter(t => t !== id);
            if (other.activeTab === id) other.activeTab = other.tabs[other.tabs.length - 1] || null;
            if (other.tabs.length === 0) other.open = false;
        }
        const d = target === 'bottom' ? _state.bottomDock : _state.rightDock;
        if (!d.tabs.includes(id)) d.tabs.push(id);
        d.open      = true;
        d.activeTab = id;
        _saveState();
        _applyLayout();
        const panel = _registry[id];
        const body  = target === 'bottom' ? _getBottomBody() : _getBody();
        if (panel && panel.onActivate && body) panel.onActivate(body);
    }

    function closeAll() {
        _state.rightDock.open       = false;
        _state.rightDock.tabs       = [];
        _state.rightDock.activeTab  = null;
        _state.bottomDock.open      = false;
        _state.bottomDock.tabs      = [];
        _state.bottomDock.activeTab = null;
        _state.floats = [];
        _saveState();
        _applyLayout();
    }

    function closeBottomDock() {
        _state.bottomDock.open      = false;
        _state.bottomDock.tabs      = [];
        _state.bottomDock.activeTab = null;
        _saveState();
        _applyLayout();
    }

    function togglePanel(id) {
        if (_state.floats?.find(f => f.id === id)) { hidePanel(id); return; }
        const rd = _state.rightDock;
        const bd = _state.bottomDock;
        if (rd.tabs.includes(id)) {
            if (rd.activeTab === id) hidePanel(id);
            else PanelTabBar.activateTabIn('right', id);
        } else if (bd.tabs.includes(id)) {
            if (bd.activeTab === id) hidePanel(id);
            else PanelTabBar.activateTabIn('bottom', id);
        } else {
            showPanel(id);
        }
    }

    function isPanelOpen(id) {
        return _state.rightDock.tabs.includes(id) ||
               _state.bottomDock.tabs.includes(id) ||
               !!(_state.floats?.find(f => f.id === id));
    }

    function isActivePanel(id) {
        return _state.rightDock.activeTab === id || _state.bottomDock.activeTab === id;
    }

    function allPanels() { return Object.values(_registry); }

    // Returns the live body element for a panel regardless of where it lives.
    function getPanelBody(id) {
        const floatEl = document.querySelector(`.panel-float[data-panel-id="${id}"]`);
        if (floatEl) return floatEl.querySelector('.panel-float-body');
        if (_state.rightDock.activeTab === id)  return _getBody();
        if (_state.bottomDock.activeTab === id) return _getBottomBody();
        return null;
    }

    function init() {
        PanelFloats.configure({
            state: _state, registry: _registry,
            FLOAT_W, FLOAT_H, SNAP_DIST,
            getDock: _getDock, getBottomDock: _getBottomDock,
            dockPanel, hidePanel, saveState: _saveState,
        });
        PanelTabBar.configure({
            state: _state, registry: _registry,
            FLOAT_W,
            getDock: _getDock, getBody: _getBody,
            getBottomDock: _getBottomDock, getBottomBody: _getBottomBody,
            hidePanel, moveToFloat, saveState: _saveState, applyLayout: _applyLayout,
        });
        _applyLayout();
        const closeBtn = document.querySelector('#sidebar-panel .sidebar-header .btn-ghost');
        if (closeBtn) closeBtn.addEventListener('click', closeAll);
        _initSidebarResize();
        _initBottomResize();
    }

    return {
        register, showPanel, hidePanel, moveToFloat, dockPanel,
        closeAll, closeBottomDock, togglePanel, isPanelOpen, isActivePanel, allPanels, init,
        getPanelBody, getExtra, setExtra
    };
})();
