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
    let _dragId       = null;
    let _dragDropped  = false;
    let _dropTarget   = null;  // 'right' | 'bottom' | null during float drag

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

    function _getFloatLayer() {
        let layer = document.getElementById('panel-float-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'panel-float-layer';
            document.body.appendChild(layer);
        }
        return layer;
    }

    // ── Layout ────────────────────────────────────────────────

    function _applyLayout() {
        _applyRightDock();
        _applyBottomDock();
        _renderFloats();
    }

    function _applyRightDock() {
        const dock = _getDock();
        if (!dock) return;
        const { open, width, tabs, activeTab } = _state.rightDock;
        const isOpen = open && tabs.length > 0;
        dock.classList.toggle('sidebar-closed', !isOpen);
        dock.style.setProperty('--sidebar-width', (width || 320) + 'px');
        _renderTabBar(tabs, activeTab);
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
        _renderBottomTabBar(tabs, activeTab);
        const titleEl = document.getElementById('bottom-dock-title');
        if (titleEl && activeTab && _registry[activeTab]) {
            titleEl.textContent = _registry[activeTab].title;
        }
        const header = dock.querySelector('.bottom-dock-header');
        if (header) header.style.display = isOpen && tabs.length === 1 ? 'flex' : 'none';
    }

    // ── Tab bars ──────────────────────────────────────────────

    function _tabsHtml(tabs, activeTab) {
        return tabs.map(id => {
            const p = _registry[id];
            if (!p) return '';
            const a = id === activeTab ? ' active' : '';
            return `<button class="panel-tab${a}" data-id="${id}" draggable="true">` +
                `<span class="panel-tab-icon">${p.icon || ''}</span>` +
                `<span class="panel-tab-label">${p.title}</span>` +
                `<span class="panel-tab-close" data-close="${id}">✕</span>` +
                `</button>`;
        }).join('');
    }

    function _renderTabBar(tabs, activeTab) {
        const dock = _getDock();
        if (!dock) return;
        let bar = dock.querySelector('.panel-tab-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'panel-tab-bar';
            const body = _getBody();
            if (body) dock.insertBefore(bar, body);
        }
        bar.style.display = tabs.length > 1 ? 'flex' : 'none';
        bar.innerHTML = _tabsHtml(tabs, activeTab);
        _initTabBarEvents(bar, 'right');
    }

    function _renderBottomTabBar(tabs, activeTab) {
        const dock = _getBottomDock();
        if (!dock) return;
        let bar = dock.querySelector('.panel-tab-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'panel-tab-bar';
            const body = _getBottomBody();
            if (body) dock.insertBefore(bar, body);
            else dock.appendChild(bar);
        }
        bar.style.display = tabs.length > 1 ? 'flex' : 'none';
        bar.innerHTML = _tabsHtml(tabs, activeTab);
        _initTabBarEvents(bar, 'bottom');
    }

    function _initTabBarEvents(bar, dockName) {
        bar.querySelectorAll('.panel-tab').forEach(btn => {
            btn.addEventListener('click', e => {
                if (e.target.closest('[data-close]')) return;
                _activateTabIn(dockName, btn.dataset.id);
            });
            btn.addEventListener('dragstart', e => {
                _dragId      = btn.dataset.id;
                _dragDropped = false;
                e.dataTransfer.setData('text/plain', _dragId);
                e.dataTransfer.effectAllowed = 'move';
                btn.classList.add('dragging');
            });
            btn.addEventListener('dragend', e => {
                btn.classList.remove('dragging');
                bar.querySelectorAll('.panel-tab').forEach(t => t.removeAttribute('data-drag-over'));
                if (!_dragDropped && _dragId) {
                    const x = Math.max(0, e.clientX - FLOAT_W / 2);
                    const y = Math.max(0, e.clientY - 20);
                    moveToFloat(_dragId, x, y);
                }
                _dragId = null;
            });
        });

        bar.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); hidePanel(btn.dataset.close); });
        });

        bar.addEventListener('dragover', e => {
            if (!_dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const overTab = e.target.closest('.panel-tab');
            bar.querySelectorAll('.panel-tab').forEach(t => t.removeAttribute('data-drag-over'));
            if (overTab && overTab.dataset.id !== _dragId) overTab.setAttribute('data-drag-over', '');
        });

        bar.addEventListener('drop', e => {
            e.preventDefault();
            _dragDropped = true;
            bar.querySelectorAll('.panel-tab').forEach(t => t.removeAttribute('data-drag-over'));
            const overTab = e.target.closest('.panel-tab');
            if (!overTab || !_dragId || overTab.dataset.id === _dragId) return;
            _reorderTabIn(dockName, _dragId, overTab.dataset.id);
        });
    }

    function _reorderTabIn(dockName, dragId, targetId) {
        const d = dockName === 'bottom' ? _state.bottomDock : _state.rightDock;
        const from = d.tabs.indexOf(dragId);
        const to   = d.tabs.indexOf(targetId);
        if (from === -1 || to === -1) return;
        d.tabs.splice(from, 1);
        d.tabs.splice(to, 0, dragId);
        _saveState();
        _applyLayout();
    }

    function _activateTabIn(dockName, id) {
        const d = dockName === 'bottom' ? _state.bottomDock : _state.rightDock;
        d.activeTab = id;
        _saveState();
        _applyLayout();
        const panel = _registry[id];
        const body  = dockName === 'bottom' ? _getBottomBody() : _getBody();
        if (panel && panel.onActivate && body) panel.onActivate(body);
    }

    // ── Floats ────────────────────────────────────────────────

    function _renderFloats() {
        const layer  = _getFloatLayer();
        const floats = _state.floats || [];

        layer.querySelectorAll('.panel-float').forEach(el => {
            if (!floats.find(f => f.id === el.dataset.panelId)) el.remove();
        });

        floats.forEach(f => {
            let el = layer.querySelector(`.panel-float[data-panel-id="${f.id}"]`);
            if (!el) {
                el = _createFloatEl(f.id);
                layer.appendChild(el);
                const panel = _registry[f.id];
                if (panel && panel.onActivate) panel.onActivate(el.querySelector('.panel-float-body'));
            }
            el.style.left   = f.x + 'px';
            el.style.top    = f.y + 'px';
            el.style.width  = f.w + 'px';
            el.style.height = f.h + 'px';
        });
    }

    function _createFloatEl(id) {
        const panel = _registry[id] || { title: id, icon: '' };
        const el    = document.createElement('div');
        el.className       = 'panel-float';
        el.dataset.panelId = id;
        el.innerHTML =
            `<div class="panel-float-titlebar">` +
                `<span class="panel-float-icon">${panel.icon || ''}</span>` +
                `<span class="panel-float-title">${panel.title}</span>` +
                `<button class="panel-float-dock-bottom" title="Dock to bottom">⊟</button>` +
                `<button class="panel-float-dock" title="Dock to right">⤵</button>` +
                `<button class="panel-float-close">✕</button>` +
            `</div>` +
            `<div class="panel-float-body"></div>` +
            `<div class="panel-float-resize"></div>`;
        el.querySelector('.panel-float-dock-bottom').addEventListener('click', () => dockPanel(id, 'bottom'));
        el.querySelector('.panel-float-dock').addEventListener('click',        () => dockPanel(id, 'right'));
        el.querySelector('.panel-float-close').addEventListener('click',       () => hidePanel(id));
        _initFloatDrag(el, id);
        _initFloatResize(el, id);
        return el;
    }

    // K-7: proximity detection wired into float drag
    function _initFloatDrag(el, id) {
        const titlebar = el.querySelector('.panel-float-titlebar');
        titlebar.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            const f = (_state.floats || []).find(f => f.id === id);
            if (!f) return;
            const ox = e.clientX - f.x;
            const oy = e.clientY - f.y;
            const onMove = ev => {
                f.x = ev.clientX - ox;
                f.y = ev.clientY - oy;
                el.style.left = f.x + 'px';
                el.style.top  = f.y + 'px';
                _checkProximity(ev.clientX, ev.clientY);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const target = _dropTarget;
                _hideDropHighlight();
                if (target) {
                    dockPanel(id, target);
                } else {
                    _saveState();
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function _initFloatResize(el, id) {
        const handle = el.querySelector('.panel-float-resize');
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            const f = (_state.floats || []).find(f => f.id === id);
            if (!f) return;
            const startX = e.clientX, startY = e.clientY;
            const startW = f.w,       startH = f.h;
            const onMove = ev => {
                f.w = Math.max(200, startW + ev.clientX - startX);
                f.h = Math.max(120, startH + ev.clientY - startY);
                el.style.width  = f.w + 'px';
                el.style.height = f.h + 'px';
            };
            const onUp = () => {
                _saveState();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Drop zone highlight (K-7) ─────────────────────────────

    function _getDropHighlight() {
        let el = document.getElementById('panel-drop-highlight');
        if (!el) {
            el = document.createElement('div');
            el.id = 'panel-drop-highlight';
            el.className = 'dock-drop-highlight';
            document.body.appendChild(el);
        }
        return el;
    }

    function _checkProximity(cx, cy) {
        let nearTarget = null;

        const rd = _getDock();
        if (rd && _state.rightDock.tabs.length > 0) {
            const r = rd.getBoundingClientRect();
            if (cx > r.left - SNAP_DIST && cx < r.right && cy > r.top && cy < r.bottom) {
                nearTarget = 'right';
            }
        }

        if (!nearTarget) {
            const bd = _getBottomDock();
            if (bd && _state.bottomDock.tabs.length > 0) {
                const r = bd.getBoundingClientRect();
                if (cy > r.top - SNAP_DIST && cy < r.bottom && cx > r.left && cx < r.right) {
                    nearTarget = 'bottom';
                }
            }
        }

        if (nearTarget) _showDropHighlight(nearTarget);
        else _hideDropHighlight();
    }

    function _showDropHighlight(dockName) {
        const hl = _getDropHighlight();
        const el = dockName === 'right' ? _getDock() : _getBottomDock();
        if (!el) { _hideDropHighlight(); return; }
        const r = el.getBoundingClientRect();
        hl.style.left   = r.left   + 'px';
        hl.style.top    = r.top    + 'px';
        hl.style.width  = r.width  + 'px';
        hl.style.height = r.height + 'px';
        hl.classList.add('visible');
        _dropTarget = dockName;
    }

    function _hideDropHighlight() {
        const hl = document.getElementById('panel-drop-highlight');
        if (hl) hl.classList.remove('visible');
        _dropTarget = null;
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

    // opts.silent=true: open/activate without calling onActivate (legacy setContent pattern).
    // opts.dock='bottom': open in bottom dock instead of right.
    function showPanel(id, opts) {
        const dockName = opts && opts.dock === 'bottom' ? 'bottom' : 'right';

        // Already floating — just refresh content (skip onActivate if silent)
        const floatEntry = (_state.floats || []).find(f => f.id === id);
        if (floatEntry) {
            const floatEl = document.querySelector(`.panel-float[data-panel-id="${id}"]`);
            if (floatEl && _registry[id]?.onActivate && !(opts && opts.silent)) {
                _registry[id].onActivate(floatEl.querySelector('.panel-float-body'));
            }
            return;
        }

        const d = dockName === 'bottom' ? _state.bottomDock : _state.rightDock;
        const wasActive = d.activeTab === id && d.tabs.includes(id) && d.open;
        if (!d.tabs.includes(id)) d.tabs.push(id);
        d.open      = true;
        d.activeTab = id;
        _saveState();
        _applyLayout();
        if (!(opts && opts.silent) && !wasActive) {
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
            else _activateTabIn('right', id);
        } else if (bd.tabs.includes(id)) {
            if (bd.activeTab === id) hidePanel(id);
            else _activateTabIn('bottom', id);
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
        _applyLayout();
        const closeBtn = document.querySelector('#sidebar-panel .sidebar-header .btn-ghost');
        if (closeBtn) closeBtn.addEventListener('click', closeAll);
        _initSidebarResize();
        _initBottomResize();
    }

    return {
        register, showPanel, hidePanel, moveToFloat, dockPanel,
        closeAll, closeBottomDock, togglePanel, isPanelOpen, isActivePanel, allPanels, init,
        getPanelBody
    };
})();
