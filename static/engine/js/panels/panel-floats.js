const PanelFloats = (() => {
    let _state, _registry;
    let _FLOAT_W, _FLOAT_H, _SNAP_DIST;
    let _getDock, _getBottomDock;
    let _dockPanel, _hidePanel, _saveState;
    let _dropTarget = null;

    function configure(deps) {
        _state         = deps.state;
        _registry      = deps.registry;
        _FLOAT_W       = deps.FLOAT_W;
        _FLOAT_H       = deps.FLOAT_H;
        _SNAP_DIST     = deps.SNAP_DIST;
        _getDock       = deps.getDock;
        _getBottomDock = deps.getBottomDock;
        _dockPanel     = deps.dockPanel;
        _hidePanel     = deps.hidePanel;
        _saveState     = deps.saveState;
    }

    // ── Float layer ───────────────────────────────────────────

    function _getFloatLayer() {
        let layer = document.getElementById('panel-float-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'panel-float-layer';
            document.body.appendChild(layer);
        }
        return layer;
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
            if (cx > r.left - _SNAP_DIST && cx < r.right && cy > r.top && cy < r.bottom) {
                nearTarget = 'right';
            }
        }
        if (!nearTarget) {
            const bd = _getBottomDock();
            if (bd && _state.bottomDock.tabs.length > 0) {
                const r = bd.getBoundingClientRect();
                if (cy > r.top - _SNAP_DIST && cy < r.bottom && cx > r.left && cx < r.right) {
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

    // ── Float drag + resize ───────────────────────────────────

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
                    _dockPanel(id, target);
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
        el.querySelector('.panel-float-dock-bottom').addEventListener('click', () => _dockPanel(id, 'bottom'));
        el.querySelector('.panel-float-dock').addEventListener('click',        () => _dockPanel(id, 'right'));
        el.querySelector('.panel-float-close').addEventListener('click',       () => _hidePanel(id));
        _initFloatDrag(el, id);
        _initFloatResize(el, id);
        return el;
    }

    // ── Public API ────────────────────────────────────────────

    function render() {
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

    return { configure, render };
})();
