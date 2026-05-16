const EtlCanvasEditor = (() => {

    // ── State ─────────────────────────────────────────────────────────────────

    let _dbPath = null, _toolId = null;
    let _model     = { sources: [], transformations: [], final_relation_id: null };
    let _toolCols  = [];
    let _positions = {};
    let _pan       = { x: 60, y: 60 }, _zoom = 1.0;
    let _panActive = false, _panStart = null, _panOrigin = null;
    let _dragNode  = null, _dragStart = null, _dragOrigin = null, _dragMoved = false;
    let _pendingAddFrom = null;
    let _canvasInited   = false;

    const NODE_W  = 230;
    const NODE_H  = 56;
    const DEST_ID = '__destination__';


    // ── localStorage ──────────────────────────────────────────────────────────

    function _posKey() {
        let h = 5381;
        const s = (_dbPath || '') + ':' + (_toolId || '');
        for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
        return `im.ecv.${h.toString(36)}`;
    }
    function _loadPos() { try { _positions = JSON.parse(localStorage.getItem(_posKey()) || '{}'); } catch (_) { _positions = {}; } }
    function _savePos() { try { localStorage.setItem(_posKey(), JSON.stringify(_positions)); } catch (_) {} }


    // ── Graph ─────────────────────────────────────────────────────────────────

    function _buildGraph() {
        const nodes = [], edges = [];
        for (const s of (_model.sources || [])) {
            nodes.push({ id: s.id, kind: 'source', sub: s.type || 'table', label: s.name || s.id, detail: s.alias ? `alias: ${s.alias}` : '' });
        }
        for (const t of (_model.transformations || [])) {
            nodes.push({ id: t.id, kind: 'transform', sub: t.type, label: _tLabel(t), detail: _tDetail(t) });
            for (const inp of (t.inputs || [])) edges.push({ from: inp, to: t.id });
        }
        nodes.push({ id: DEST_ID, kind: 'dest', sub: 'dest', label: 'Destination', detail: `${_toolCols.length} column(s)` });
        if (_model.final_relation_id) edges.push({ from: _model.final_relation_id, to: DEST_ID });
        return { nodes, edges };
    }

    function _tLabel(t) {
        return { select: 'Select', filter: 'Filter', join: 'Join', aggregate: 'Aggregate', compute_column: 'Compute' }[t.type] || t.type;
    }

    function _tDetail(t) {
        if (t.type === 'select')         return `${(t.columns || []).length} col(s)`;
        if (t.type === 'filter')         return `${(t.mode || 'WHERE').toUpperCase()}`;
        if (t.type === 'join')           return `${t.join_type || 'INNER'} JOIN`;
        if (t.type === 'aggregate')      return `${(t.group_by || []).length} group(s), ${(t.aggregations || []).length} agg(s)`;
        if (t.type === 'compute_column') return t.column?.alias || '';
        return '';
    }


    // ── Auto-layout (BFS topological) ────────────────────────────────────────

    function _autoLayout(nodes, edges) {
        const inDeg = {}, children = {};
        for (const n of nodes) { inDeg[n.id] = 0; children[n.id] = []; }
        for (const e of edges) {
            if (inDeg[e.to] !== undefined) inDeg[e.to]++;
            if (children[e.from]) children[e.from].push(e.to);
        }
        const layers = {}, queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
        for (const id of queue) layers[id] = 0;
        let head = 0;
        while (head < queue.length) {
            const id = queue[head++];
            for (const ch of (children[id] || [])) {
                layers[ch] = Math.max(layers[ch] ?? 0, (layers[id] ?? 0) + 1);
                if (!queue.includes(ch)) queue.push(ch);
            }
        }
        const byLayer = {};
        for (const n of nodes) { const l = layers[n.id] ?? 0; (byLayer[l] = byLayer[l] || []).push(n); }
        const pos = {};
        for (const [l, grp] of Object.entries(byLayer)) {
            const x = 60 + Number(l) * 290;
            let y = 60 + Math.max(0, (480 - grp.length * NODE_H - (grp.length - 1) * 80) / 2);
            for (const n of grp) { pos[n.id] = { x, y }; y += NODE_H + 80; }
        }
        return pos;
    }


    // ── Render ────────────────────────────────────────────────────────────────

    function _applyTransform() {
        const inner = document.getElementById('ecv-canvas-inner');
        if (inner) inner.style.transform = `translate(${_pan.x}px,${_pan.y}px) scale(${_zoom})`;
    }

    function _nodeIcon(sub) {
        return { table: '📊', cte: '📝', generate_series: '🔢', select: '📋', filter: '🔍', join: '🔗', aggregate: '∑', compute_column: 'ƒ', dest: '🎯' }[sub] || '⚙';
    }

    function _esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _renderNodes(nodes) {
        const layer = document.getElementById('ecv-nodes-layer');
        if (!layer) return;
        layer.innerHTML = nodes.map(n => {
            const p    = _positions[n.id] || { x: 60, y: 60 };
            const isDest = n.id === DEST_ID;
            const addBtn = isDest ? '' : `<button class="ecv-add-btn" data-from="${_esc(n.id)}" title="Add transformation">+</button>`;
            return `<div class="ecv-node ecv-node--${_esc(n.sub)}" data-id="${_esc(n.id)}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;">
                <div class="ecv-node-icon">${_nodeIcon(n.sub)}</div>
                <div class="ecv-node-body">
                    <div class="ecv-node-label">${_esc(n.label)}</div>
                    <div class="ecv-node-detail">${_esc(n.detail)}</div>
                </div>
                ${addBtn}
            </div>`;
        }).join('');

        for (const el of layer.querySelectorAll('.ecv-node')) {
            el.addEventListener('mousedown', _onNodeMousedown);
            el.addEventListener('click', _onNodeClick);
        }
        for (const btn of layer.querySelectorAll('.ecv-add-btn')) {
            btn.addEventListener('click', e => { e.stopPropagation(); _showAddPopup(btn.dataset.from, e.clientX, e.clientY); });
        }
    }

    function _renderEdges(edges) {
        const svg = document.getElementById('ecv-edges-svg');
        if (!svg) return;
        svg.querySelectorAll('path.ecv-edge, path.ecv-edge-hit').forEach(p => p.remove());
        for (const edge of edges) {
            const from = _positions[edge.from], to = _positions[edge.to];
            if (!from || !to) continue;
            const x0 = from.x + NODE_W, y0 = from.y + NODE_H / 2;
            const x1 = to.x,            y1 = to.y  + NODE_H / 2;
            const cx = Math.abs(x1 - x0) * 0.5 + 40;
            const d  = `M${x0},${y0} C${x0+cx},${y0} ${x1-cx},${y1} ${x1},${y1}`;
            const mk = attr => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('class', attr); return p; };
            svg.appendChild(mk('ecv-edge'));
            const hit = mk('ecv-edge-hit');
            hit.dataset.from = edge.from; hit.dataset.to = edge.to;
            svg.appendChild(hit);
        }
    }

    function _render() {
        const { nodes, edges } = _buildGraph();
        _renderNodes(nodes);
        _renderEdges(edges);
        _applyTransform();
    }


    // ── Node interaction ──────────────────────────────────────────────────────

    function _onNodeMousedown(e) {
        if (e.button !== 0 || e.target.classList.contains('ecv-add-btn')) return;
        e.stopPropagation();
        const id  = this.dataset.id;
        const pos = _positions[id] || { x: 0, y: 0 };
        _dragNode   = id;
        _dragStart  = { mx: e.clientX, my: e.clientY };
        _dragOrigin = { x: pos.x, y: pos.y };
        _dragMoved  = false;
    }

    function _onNodeClick(e) {
        if (_dragMoved || e.target.classList.contains('ecv-add-btn')) return;
        _openPanel(this.dataset.id);
    }


    // ── Add source ────────────────────────────────────────────────────────────

    async function _showAddSourcePopup(e) {
        e.stopPropagation();
        const popup = document.getElementById('ecv-src-popup');
        if (!popup) return;
        const wr = document.getElementById('ecv-canvas-wrap').getBoundingClientRect();
        const br = e.currentTarget.getBoundingClientRect();
        popup.style.left = (br.left - wr.left) + 'px';
        popup.style.top  = (br.bottom - wr.top + 4) + 'px';
        popup.style.display = 'block';
        popup.innerHTML = '<div class="ecv-src-loading">Loading…</div>';
        try {
            const tools = await ApiClient.listProjectTools();
            popup.innerHTML = tools.map(t =>
                `<button onclick="EtlCanvasEditor.addSource('table','${_esc(t.slug)}','${_esc(t.name)}')">📊 ${_esc(t.name)}</button>`
            ).join('') + `<hr class="ecv-src-sep">` +
                `<button onclick="EtlCanvasEditor.addSource('cte','','cte')">📝 CTE (SQL)</button>` +
                `<button onclick="EtlCanvasEditor.addSource('generate_series','','n')">🔢 generate_series</button>`;
        } catch (_) {
            popup.innerHTML = '<div class="ecv-src-loading" style="color:#ef4444">Error</div>';
        }
        setTimeout(() => {
            const hide = ev => { if (!popup.contains(ev.target)) { popup.style.display = 'none'; document.removeEventListener('mousedown', hide); } };
            document.addEventListener('mousedown', hide);
        }, 0);
    }

    function addSource(type, name, alias) {
        document.getElementById('ecv-src-popup').style.display = 'none';
        const id  = `src_${type}_${Date.now()}`;
        const src = { id, type, name: type === 'generate_series' ? '_generate_series' : name, alias, sql: '' };
        if (type === 'generate_series') { src.start = 1; src.end_expr = { type: 'literal', value: 10 }; }
        _model.sources.push(src);
        _positions[id] = { x: 60, y: 60 + (_model.sources.length - 1) * 130 };
        _savePos();
        _render();
        if (type !== 'table') _openPanel(id);
    }


    // ── Edge preview ──────────────────────────────────────────────────────────

    async function _onEdgeClick(from, clientX, clientY) {
        const r = document.getElementById('ecv-canvas-wrap').getBoundingClientRect();
        const x = clientX - r.left, y = clientY - r.top;
        EtlCanvasPreview.show(null, x, y, from);
        try {
            const data = await ApiClient.etlPreview({ sources: _model.sources, transformations: _model.transformations, final_relation_id: from });
            EtlCanvasPreview.show(data, x, y, from);
        } catch (err) { EtlCanvasPreview.showError(err.message, x, y); }
    }


    // ── Canvas pan + zoom ─────────────────────────────────────────────────────

    function _initCanvas() {
        const wrap = document.getElementById('ecv-canvas-wrap');
        if (!wrap) return;

        const svg = document.getElementById('ecv-edges-svg');
        if (svg) svg.addEventListener('click', e => {
            if (e.target.dataset.from) _onEdgeClick(e.target.dataset.from, e.clientX, e.clientY);
        });

        wrap.addEventListener('mousedown', e => {
            if (e.button !== 0 || e.target.closest('.ecv-node') || e.target.classList.contains('ecv-edge-hit')) return;
            _panActive = true;
            _panStart  = { mx: e.clientX, my: e.clientY };
            _panOrigin = { x: _pan.x, y: _pan.y };
            wrap.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', e => {
            if (_dragNode) {
                const dx = (e.clientX - _dragStart.mx) / _zoom;
                const dy = (e.clientY - _dragStart.my) / _zoom;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _dragMoved = true;
                _positions[_dragNode] = { x: _dragOrigin.x + dx, y: _dragOrigin.y + dy };
                const el = document.querySelector(`#ecv-nodes-layer [data-id="${CSS.escape(_dragNode)}"]`);
                if (el) { el.style.left = _positions[_dragNode].x + 'px'; el.style.top = _positions[_dragNode].y + 'px'; }
                _renderEdges(_buildGraph().edges);
                return;
            }
            if (!_panActive) return;
            _pan.x = _panOrigin.x + (e.clientX - _panStart.mx);
            _pan.y = _panOrigin.y + (e.clientY - _panStart.my);
            _applyTransform();
        });

        window.addEventListener('mouseup', () => {
            if (_dragNode) { if (_dragMoved) _savePos(); _dragNode = null; }
            if (_panActive) { _panActive = false; wrap.style.cursor = 'grab'; }
        });

        wrap.addEventListener('wheel', e => {
            e.preventDefault();
            const rect = wrap.getBoundingClientRect();
            const mx   = e.clientX - rect.left, my = e.clientY - rect.top;
            const nz   = Math.min(3.0, Math.max(0.3, _zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
            _pan.x = mx - (mx - _pan.x) * (nz / _zoom);
            _pan.y = my - (my - _pan.y) * (nz / _zoom);
            _zoom  = nz;
            _applyTransform();
        }, { passive: false });
    }


    // ── Side panel ────────────────────────────────────────────────────────────

    function _getSourceList() {
        const list = [];
        for (const s of (_model.sources || []))        list.push({ id: s.id, label: `${s.name || s.id} (${s.alias || s.id})` });
        for (const t of (_model.transformations || [])) list.push({ id: t.id, label: `${t.type} · ${t.id}` });
        return list;
    }

    function _onModelChange() { _render(); }

    function _openPanel(nodeId) {
        _hideAddPopup();
        EtlCanvasPanel.open(nodeId, _model, _getSourceList(), _toolCols, _onModelChange);
    }

    function closePanel() { EtlCanvasPanel.close(); }


    // ── Add popup ─────────────────────────────────────────────────────────────

    function _showAddPopup(fromId, clientX, clientY) {
        _pendingAddFrom = fromId;
        const popup = document.getElementById('ecv-add-popup');
        const wrap  = document.getElementById('ecv-canvas-wrap');
        if (!popup || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        popup.style.left    = (clientX - rect.left + 12) + 'px';
        popup.style.top     = (clientY - rect.top  - 10) + 'px';
        popup.style.display = 'block';
        setTimeout(() => {
            const hide = e => { if (!popup.contains(e.target)) { _hideAddPopup(); document.removeEventListener('mousedown', hide); } };
            document.addEventListener('mousedown', hide);
        }, 0);
    }

    function _hideAddPopup() {
        const popup = document.getElementById('ecv-add-popup');
        if (popup) popup.style.display = 'none';
        _pendingAddFrom = null;
    }

    function addNode(type) {
        const fromId = _pendingAddFrom;
        _hideAddPopup();
        if (!fromId) return;

        const newId = `t_${type}_${Date.now()}`;
        const t = { id: newId, type, inputs: [fromId] };
        if (type === 'select')         { t.columns = []; }
        if (type === 'filter')         { t.mode = 'where'; t.condition = {}; }
        if (type === 'join')           { t.join_type = 'INNER'; t.left_input = fromId; t.right_source = ''; t.alias = ''; t.condition = {}; t.inputs = [fromId]; }
        if (type === 'aggregate')      { t.group_by = []; t.aggregations = []; }
        if (type === 'compute_column') { t.column = { id: `c_${Date.now()}`, alias: '', expr: { type: 'literal', value: null } }; }

        _model.transformations.push(t);
        _model.final_relation_id = newId;

        const fromPos = _positions[fromId] || { x: 60, y: 60 };
        _positions[newId] = { x: fromPos.x + 290, y: fromPos.y };
        _savePos();
        _render();
        _openPanel(newId);
    }


    // ── Tool columns ──────────────────────────────────────────────────────────

    async function _loadToolCols() {
        try {
            const data = await fetch(`/api/engines/${_toolId}/columns?db=${encodeURIComponent(_dbPath)}`).then(r => r.json());
            _toolCols = (data || []).filter(c => !c.is_system);
        } catch (_) {}
    }


    // ── Activate / deactivate ─────────────────────────────────────────────────

    async function activate() {
        if (typeof EtlEditor !== 'undefined') _model = EtlEditor.getModel();
        if (_toolCols.length === 0) await _loadToolCols();

        document.getElementById('ecv-view').style.display      = 'flex';
        document.getElementById('ecv-code-view').style.display = 'none';
        document.getElementById('ecv-btn-canvas')?.classList.add('ecv-toggle-btn--active');
        document.getElementById('ecv-btn-code')?.classList.remove('ecv-toggle-btn--active');

        if (!_canvasInited) { _initCanvas(); _canvasInited = true; }

        const { nodes, edges } = _buildGraph();
        const auto = _autoLayout(nodes, edges);
        for (const [id, pos] of Object.entries(auto)) {
            if (!_positions[id]) _positions[id] = pos;
        }
        _render();
    }

    function deactivate() {
        if (typeof EtlEditor !== 'undefined') EtlEditor.loadModel(JSON.parse(JSON.stringify(_model)));
        document.getElementById('ecv-view').style.display      = 'none';
        document.getElementById('ecv-code-view').style.display = 'flex';
        document.getElementById('ecv-btn-canvas')?.classList.remove('ecv-toggle-btn--active');
        document.getElementById('ecv-btn-code')?.classList.add('ecv-toggle-btn--active');
    }


    // ── Init ──────────────────────────────────────────────────────────────────

    function init(dbPath, toolId) {
        _dbPath = dbPath;
        _toolId    = toolId;
        _loadPos();
    }


    return { init, activate, deactivate, closePanel, addNode, addSource, showAddSourcePopup: _showAddSourcePopup, closePreview: () => EtlCanvasPreview.close() };

})();
