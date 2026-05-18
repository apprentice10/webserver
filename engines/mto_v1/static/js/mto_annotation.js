/* MTO annotation overlay — drop target, two-click label/arrow placement on the image viewport. */
const MtoAnnotation = (() => {
    let _viewport     = null;
    let _overlay      = null;
    let _typicalId    = null;
    let _placements   = [];
    let _pending      = null;   // { tag, lx, ly } fracs [0–1] while awaiting arrow click
    let _liveEl       = null;   // SVG <line> during crosshair
    let _dropHandler  = null;
    let _onPlace      = null;   // optional callback(placement) wired by Step 15
    let _crosshairActive = false;
    let _dragging     = null;   // { idx, which:'label'|'arrow' } while repositioning

    const _HANDLE_R = 6;

    // ── coord helpers ─────────────────────────────────────────────────────

    function _vpCoords(e) {
        const r = _viewport.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }

    function _inViewport(e) {
        const r = _viewport.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right &&
               e.clientY >= r.top  && e.clientY <= r.bottom;
    }

    // ── SVG helpers ───────────────────────────────────────────────────────

    function _svgEl(tag, attrs) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    }

    function _labelGroup(tag, lx, ly, pending) {
        const PAD = 4, FONT = 11, cw = Math.max(tag.length * 7 + PAD * 2, 24), ch = FONT + PAD * 2;
        const g = _svgEl('g', {});
        g.appendChild(_svgEl('rect', {
            x: lx - cw / 2, y: ly - ch / 2, width: cw, height: ch, rx: 3,
            fill: pending ? '#f59e0b' : '#1a73e8', stroke: '#fff', 'stroke-width': 1
        }));
        const txt = _svgEl('text', {
            x: lx, y: ly + FONT / 2 - 1, 'text-anchor': 'middle',
            fill: '#fff', 'font-size': FONT, 'font-family': 'sans-serif', 'font-weight': 'bold'
        });
        txt.textContent = tag;
        g.appendChild(txt);
        return g;
    }

    function _addArrowDef() {
        const defs = _svgEl('defs', {});
        const mk = _svgEl('marker', { id: 'mto-arrowhead', markerWidth: 6, markerHeight: 6, refX: 5, refY: 3, orient: 'auto' });
        mk.appendChild(_svgEl('path', { d: 'M0,0 L0,6 L6,3 Z', fill: '#1a73e8' }));
        defs.appendChild(mk);
        _overlay.appendChild(defs);
    }

    function _addStyle() {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        s.textContent = '.mto-grab{opacity:0;transition:opacity .15s;cursor:grab}.mto-grab:hover{opacity:1}';
        _overlay.appendChild(s);
    }

    function _grabHandle(cx, cy) {
        return _svgEl('circle', {
            cx, cy, r: _HANDLE_R,
            fill: 'rgba(26,115,232,0.25)', stroke: '#1a73e8', 'stroke-width': 1.5,
            class: 'mto-grab', 'pointer-events': 'all'
        });
    }

    function _startDrag(e, idx, which) {
        e.stopPropagation(); // prevent image pan/zoom
        e.preventDefault();
        _dragging = { idx, which };

        function onMove(ev) {
            const { x, y } = _vpCoords(ev);
            const p = _placements[_dragging.idx];
            if (_dragging.which === 'label') { p.lx = x; p.ly = y; }
            else                             { p.ax = x; p.ay = y; }
            _renderAll();
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (_onPlace) _onPlace(_placements[idx]);
            _dragging = null;
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    // ── render ────────────────────────────────────────────────────────────

    function _renderAll() {
        if (!_overlay) return;
        const W = _viewport.clientWidth, H = _viewport.clientHeight;
        _overlay.innerHTML = '';
        _addArrowDef();
        _addStyle();
        for (let i = 0; i < _placements.length; i++) {
            const p = _placements[i];
            const lx = p.lx * W, ly = p.ly * H, ax = p.ax * W, ay = p.ay * H;
            _overlay.appendChild(_svgEl('line', {
                x1: lx, y1: ly, x2: ax, y2: ay,
                stroke: '#1a73e8', 'stroke-width': 1.5, 'marker-end': 'url(#mto-arrowhead)'
            }));
            _overlay.appendChild(_labelGroup(p.tag, lx, ly, false));

            const lh = _grabHandle(lx, ly);
            lh.addEventListener('mousedown', e => _startDrag(e, i, 'label'));
            _overlay.appendChild(lh);

            const ah = _grabHandle(ax, ay);
            ah.addEventListener('mousedown', e => _startDrag(e, i, 'arrow'));
            _overlay.appendChild(ah);
        }
        if (_pending) {
            _overlay.appendChild(_labelGroup(_pending.tag, _pending.lx * W, _pending.ly * H, true));
        }
    }

    // ── crosshair mode ────────────────────────────────────────────────────

    function _startCrosshair() {
        if (_crosshairActive) return;
        _crosshairActive = true;
        _viewport.style.cursor = 'crosshair';
        const W = _viewport.clientWidth, H = _viewport.clientHeight;
        const lx = _pending.lx * W, ly = _pending.ly * H;

        _liveEl = _svgEl('line', {
            x1: lx, y1: ly, x2: lx, y2: ly,
            stroke: '#1a73e8', 'stroke-width': 1.5, 'stroke-dasharray': '4 3'
        });
        _overlay.appendChild(_liveEl);

        function onMove(e) {
            if (!_liveEl) return;
            const r = _viewport.getBoundingClientRect();
            _liveEl.setAttribute('x2', e.clientX - r.left);
            _liveEl.setAttribute('y2', e.clientY - r.top);
        }

        function onClick(e) {
            if (!_pending || !_inViewport(e)) return;
            const { x, y } = _vpCoords(e);
            const p = { tag: _pending.tag, lx: _pending.lx, ly: _pending.ly, ax: x, ay: y };
            _placements.push(p);
            _pending = null;
            if (_liveEl) { _liveEl.remove(); _liveEl = null; }
            _renderAll();
            if (_onPlace) _onPlace(p);
            cleanup();
        }

        function onKey(e) {
            if (e.key !== 'Escape') return;
            _pending = null;
            if (_liveEl) { _liveEl.remove(); _liveEl = null; }
            _renderAll();
            cleanup();
        }

        function cleanup() {
            _crosshairActive = false;
            _viewport.style.cursor = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKey);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('click', onClick);
        document.addEventListener('keydown', onKey);
    }

    // ── drop detection ────────────────────────────────────────────────────

    function _initDrop() {
        if (_dropHandler) document.removeEventListener('mouseup', _dropHandler);
        _dropHandler = function (e) {
            if (e.button !== 0) return;
            const drag = typeof MtoMaterials !== 'undefined' ? MtoMaterials.getActiveDrag() : null;
            if (!drag || drag.typicalId !== _typicalId) return;
            if (!_inViewport(e)) return;
            _placements = _placements.filter(p => p.tag !== drag.tagValue);
            const { x, y } = _vpCoords(e);
            _pending = { tag: drag.tagValue, lx: x, ly: y };
            _renderAll();
            _startCrosshair();
        };
        document.addEventListener('mouseup', _dropHandler);
    }

    // ── public ────────────────────────────────────────────────────────────

    function init(viewport, typicalId) {
        _viewport        = viewport;
        _typicalId       = typicalId;
        _placements      = [];
        _pending         = null;
        _liveEl          = null;
        _crosshairActive = false;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
        _overlay = svg;
        viewport.style.position = 'relative';
        viewport.appendChild(svg);
        _addArrowDef();
        _initDrop();
    }

    function setPlacements(arr) {
        _placements = (arr || []).map(p => ({ tag: p.tag, lx: p.label_x, ly: p.label_y, ax: p.arrow_x, ay: p.arrow_y }));
        _renderAll();
    }

    function onPlace(cb) { _onPlace = cb; }

    return { init, setPlacements, onPlace };
})();
