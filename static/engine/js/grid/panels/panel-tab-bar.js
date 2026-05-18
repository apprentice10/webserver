const PanelTabBar = (() => {
    let _state, _registry;
    let _FLOAT_W;
    let _getDock, _getBody, _getBottomDock, _getBottomBody;
    let _hidePanel, _moveToFloat, _saveState, _applyLayout;
    let _dragId      = null;
    let _dragDropped = false;

    function configure(deps) {
        _state         = deps.state;
        _registry      = deps.registry;
        _FLOAT_W       = deps.FLOAT_W;
        _getDock       = deps.getDock;
        _getBody       = deps.getBody;
        _getBottomDock = deps.getBottomDock;
        _getBottomBody = deps.getBottomBody;
        _hidePanel     = deps.hidePanel;
        _moveToFloat   = deps.moveToFloat;
        _saveState     = deps.saveState;
        _applyLayout   = deps.applyLayout;
    }

    // ── HTML ──────────────────────────────────────────────────

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

    // ── Render ────────────────────────────────────────────────

    function renderTabBar(tabs, activeTab) {
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

    function renderBottomTabBar(tabs, activeTab) {
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

    // ── Events ────────────────────────────────────────────────

    function _initTabBarEvents(bar, dockName) {
        bar.querySelectorAll('.panel-tab').forEach(btn => {
            btn.addEventListener('click', e => {
                if (e.target.closest('[data-close]')) return;
                activateTabIn(dockName, btn.dataset.id);
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
                    const x = Math.max(0, e.clientX - _FLOAT_W / 2);
                    const y = Math.max(0, e.clientY - 20);
                    _moveToFloat(_dragId, x, y);
                }
                _dragId = null;
            });
        });

        bar.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); _hidePanel(btn.dataset.close); });
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

    // ── Public API ────────────────────────────────────────────

    function activateTabIn(dockName, id) {
        const d = dockName === 'bottom' ? _state.bottomDock : _state.rightDock;
        d.activeTab = id;
        _saveState();
        _applyLayout();
        const panel = _registry[id];
        const body  = dockName === 'bottom' ? _getBottomBody() : _getBody();
        if (panel && panel.onActivate && body) panel.onActivate(body);
    }

    return { configure, renderTabBar, renderBottomTabBar, activateTabIn };
})();
