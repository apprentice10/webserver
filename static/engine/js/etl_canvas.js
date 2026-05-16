/**
 * static/engine/js/etl_canvas.js
 * --------------------------------
 * Per-tool ETL model canvas. Renders sources and transformation steps
 * from a tool's etl_model as draggable node cards with SVG bezier edges.
 * Supports pan, zoom, and ETL run for the current tool.
 */

const EtlCanvas = (() => {

    // ── State ─────────────────────────────────────────────────────────────

    let _dbPath = null;
    let _toolId = null;
    let _model     = { sources: [], transformations: [], final_relation_id: null };
    let _positions = {};
    let _pan       = { x: 60, y: 60 };
    let _zoom      = 1.0;

    let _panActive  = false;
    let _panStart   = null;
    let _panOrigin  = null;
    let _dragNode   = null;
    let _dragStart  = null;
    let _dragOrigin = null;
    let _dragMoved  = false;

    const NODE_W = 230;
    const NODE_H = 58;


    // ── localStorage ──────────────────────────────────────────────────────

    function _posKey() {
        let h = 5381;
        const s = (_dbPath || '') + ':' + (_toolId || '');
        for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
        return `instrumentManager.etlCanvas.${h.toString(36)}.positions`;
    }

    function _loadPositions() {
        try {
            const raw = localStorage.getItem(_posKey());
            _positions = raw ? JSON.parse(raw) : {};
        } catch (_) { _positions = {}; }
    }

    function _savePositions() {
        try { localStorage.setItem(_posKey(), JSON.stringify(_positions)); } catch (_) {}
    }


    // ── Graph building ────────────────────────────────────────────────────

    function _buildGraph() {
        const nodes = [];
        const edges = [];

        for (const s of (_model.sources || [])) {
            nodes.push({
                id:     s.id,
                kind:   "source",
                sub:    s.type || "table",
                label:  s.name || s.id,
                detail: _sourceDetail(s),
                isFinal: false,
            });
        }

        for (const t of (_model.transformations || [])) {
            const isFinal = t.id === _model.final_relation_id;
            nodes.push({
                id:     t.id,
                kind:   "transform",
                sub:    t.type || "select",
                label:  _transformLabel(t),
                detail: _transformDetail(t),
                isFinal,
            });
            for (const inp of (t.inputs || [])) {
                edges.push({ from: inp, to: t.id });
            }
        }

        return { nodes, edges };
    }

    function _sourceDetail(s) {
        if (s.type === "table")           return `table · alias: ${s.alias || s.name}`;
        if (s.type === "cte")             return `CTE · ${s.alias || ""}`;
        if (s.type === "generate_series") return `series · n=${s.alias || "n"}`;
        return s.alias || "";
    }

    function _transformLabel(t) {
        const map = {
            select:    "Select",
            filter:    "Filter",
            join:      "Join",
            aggregate: "Aggregate",
            compute:   "Compute",
        };
        return map[t.type] || t.type;
    }

    function _transformDetail(t) {
        if (t.type === "select")    return `${(t.columns || []).length} column(s)`;
        if (t.type === "filter")    return `${(t.mode || "where").toUpperCase()} · ${_condSummary(t.condition)}`;
        if (t.type === "join")      return `${t.join_type || "INNER"} JOIN`;
        if (t.type === "aggregate") return `GROUP BY ${(t.group_by || []).length} col(s) · ${(t.aggregates || []).length} agg(s)`;
        if (t.type === "compute")   return `${(t.columns || []).length} computed col(s)`;
        return "";
    }

    function _condSummary(cond) {
        if (!cond) return "";
        if (cond.type === "logical")     return `${cond.op?.toUpperCase()} ${(cond.args || []).length} cond(s)`;
        if (cond.type === "binary_op")   return cond.op || "cond";
        if (cond.type === "is_null")     return "IS NULL";
        if (cond.type === "is_not_null") return "IS NOT NULL";
        return cond.type || "";
    }


    // ── Auto-layout (BFS topological) ─────────────────────────────────────

    function _autoLayout(nodes, edges) {
        const inDeg    = {};
        const children = {};
        for (const n of nodes) { inDeg[n.id] = 0; children[n.id] = []; }
        for (const e of edges) {
            if (inDeg[e.to]   !== undefined) inDeg[e.to]++;
            if (children[e.from]) children[e.from].push(e.to);
        }

        const layers = {};
        const queue  = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
        for (const id of queue) layers[id] = 0;

        let head = 0;
        while (head < queue.length) {
            const id = queue[head++];
            for (const child of (children[id] || [])) {
                layers[child] = Math.max(layers[child] ?? 0, (layers[id] ?? 0) + 1);
                if (!queue.includes(child)) queue.push(child);
            }
        }
        for (const n of nodes) {
            if (layers[n.id] === undefined) layers[n.id] = 0;
        }

        const byLayer = {};
        for (const n of nodes) {
            const l = layers[n.id];
            (byLayer[l] = byLayer[l] || []).push(n);
        }

        const layerX   = 60;
        const layerGap = 290;
        const nodeGap  = 90;
        const positions = {};
        for (const [l, group] of Object.entries(byLayer)) {
            const x       = layerX + Number(l) * layerGap;
            const totalH  = group.length * NODE_H + (group.length - 1) * nodeGap;
            let   y       = 60 + Math.max(0, (500 - totalH) / 2);
            for (const n of group) {
                positions[n.id] = { x, y };
                y += NODE_H + nodeGap;
            }
        }
        return positions;
    }


    // ── Render ────────────────────────────────────────────────────────────

    function _applyTransform() {
        const inner = document.getElementById("ecn-canvas-inner");
        if (inner) {
            inner.style.transform = `translate(${_pan.x}px,${_pan.y}px) scale(${_zoom})`;
        }
    }

    function _nodeIcon(n) {
        if (n.kind === "source") {
            const map = { table: "📊", cte: "📝", generate_series: "🔢" };
            return map[n.sub] || "📄";
        }
        const map = { select: "📋", filter: "🔍", join: "🔗", aggregate: "∑", compute: "ƒ" };
        return map[n.sub] || "⚙";
    }

    function _nodeClass(n) {
        let cls = `ecn ecn--${n.sub}`;
        if (n.isFinal) cls += " ecn--final";
        return cls;
    }

    function _renderNodes(nodes, positions) {
        const layer = document.getElementById("ecn-nodes-layer");
        if (!layer) return;
        layer.innerHTML = nodes.map(n => {
            const pos = positions[n.id] || { x: 60, y: 60 };
            return `<div class="${_esc(_nodeClass(n))}"
                        data-id="${_esc(n.id)}"
                        style="left:${pos.x}px;top:${pos.y}px;width:${NODE_W}px;">
                <div class="ecn-icon">${_nodeIcon(n)}</div>
                <div class="ecn-body">
                    <div class="ecn-label">${_esc(n.label)}</div>
                    <div class="ecn-detail">${_esc(n.detail)}</div>
                </div>
                ${n.isFinal ? '<div class="ecn-final-badge">out</div>' : ""}
            </div>`;
        }).join("");

        for (const el of layer.querySelectorAll(".ecn")) {
            _initNodeDrag(el);
        }
    }

    function _renderEdges(edges, positions) {
        const svg = document.getElementById("ecn-edges-svg");
        if (!svg) return;
        svg.querySelectorAll("path.ecn-edge").forEach(p => p.remove());

        for (const edge of edges) {
            const from = positions[edge.from];
            const to   = positions[edge.to];
            if (!from || !to) continue;

            const x0 = from.x + NODE_W;
            const y0 = from.y + NODE_H / 2;
            const x1 = to.x;
            const y1 = to.y + NODE_H / 2;
            const cx = Math.abs(x1 - x0) * 0.5 + 40;

            const d    = `M${x0},${y0} C${x0+cx},${y0} ${x1-cx},${y1} ${x1},${y1}`;
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("class", "ecn-edge");
            svg.appendChild(path);
        }
    }

    function _render() {
        const { nodes, edges } = _buildGraph();
        const hint = document.getElementById("ecn-empty-hint");
        if (hint) hint.style.display = nodes.length === 0 ? "" : "none";
        _renderNodes(nodes, _positions);
        _renderEdges(edges, _positions);
        _applyTransform();
    }

    function _esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }


    // ── Node drag ─────────────────────────────────────────────────────────

    function _initNodeDrag(el) {
        el.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const id  = el.dataset.id;
            const pos = _positions[id] || { x: 0, y: 0 };
            _dragNode   = id;
            _dragStart  = { mx: e.clientX, my: e.clientY };
            _dragOrigin = { x: pos.x, y: pos.y };
            _dragMoved  = false;
            document.getElementById("ecn-canvas-wrap")?.classList.add("dragging");
        });
    }


    // ── Canvas pan + zoom ─────────────────────────────────────────────────

    function _initCanvas() {
        const wrap = document.getElementById("ecn-canvas-wrap");
        if (!wrap) return;

        wrap.addEventListener("mousedown", e => {
            if (e.button !== 0 || e.target.closest(".ecn")) return;
            _panActive = true;
            _panStart  = { mx: e.clientX, my: e.clientY };
            _panOrigin = { x: _pan.x, y: _pan.y };
            wrap.classList.add("panning");
        });

        window.addEventListener("mousemove", e => {
            if (_dragNode) {
                const dx = (e.clientX - _dragStart.mx) / _zoom;
                const dy = (e.clientY - _dragStart.my) / _zoom;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _dragMoved = true;
                _positions[_dragNode] = {
                    x: _dragOrigin.x + dx,
                    y: _dragOrigin.y + dy,
                };
                const el = document.querySelector(`[data-id="${CSS.escape(_dragNode)}"]`);
                if (el) {
                    el.style.left = _positions[_dragNode].x + "px";
                    el.style.top  = _positions[_dragNode].y + "px";
                }
                const { edges } = _buildGraph();
                _renderEdges(edges, _positions);
                return;
            }
            if (!_panActive) return;
            _pan.x = _panOrigin.x + (e.clientX - _panStart.mx);
            _pan.y = _panOrigin.y + (e.clientY - _panStart.my);
            _applyTransform();
        });

        window.addEventListener("mouseup", () => {
            if (_dragNode) {
                if (_dragMoved) _savePositions();
                _dragNode = null;
                document.getElementById("ecn-canvas-wrap")?.classList.remove("dragging");
            }
            if (_panActive) {
                _panActive = false;
                wrap.classList.remove("panning");
            }
        });

        wrap.addEventListener("wheel", e => {
            e.preventDefault();
            const rect  = wrap.getBoundingClientRect();
            const mx    = e.clientX - rect.left;
            const my    = e.clientY - rect.top;
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZ  = Math.min(3.0, Math.max(0.3, _zoom * delta));
            _pan.x = mx - (mx - _pan.x) * (newZ / _zoom);
            _pan.y = my - (my - _pan.y) * (newZ / _zoom);
            _zoom  = newZ;
            _applyTransform();
        }, { passive: false });
    }


    // ── Tool info in crumbs ───────────────────────────────────────────────

    async function _loadToolInfo() {
        try {
            const tools = await fetch(`/api/engines/project?db=${encodeURIComponent(_dbPath)}`).then(r => r.json());
            const tool  = tools.find(t => t.id === _toolId);
            if (tool) {
                const el = document.getElementById("tool-name");
                if (el) el.textContent = tool.name || "Tool";
            }
            const proj = await fetch(`/api/project?db=${encodeURIComponent(_dbPath)}`).then(r => r.json());
            const pelEl = document.getElementById("project-name");
            if (pelEl) pelEl.textContent = proj.name || "Project";
        } catch (_) {}
    }


    // ── Public API ────────────────────────────────────────────────────────

    async function init(dbPath, toolId) {
        _dbPath = dbPath;
        _toolId = toolId;
        _loadPositions();
        _initCanvas();
        _loadToolInfo();

        try {
            const config = await fetch(
                `/api/engines/${toolId}/etl/config?db=${encodeURIComponent(dbPath)}`
            ).then(r => r.json());
            _model = config.etl_model || { sources: [], transformations: [], final_relation_id: null };
        } catch (err) {
            _showToast("Failed to load ETL model: " + err.message, "error");
            _model = { sources: [], transformations: [], final_relation_id: null };
        }

        const { nodes, edges } = _buildGraph();
        if (nodes.some(n => !_positions[n.id])) {
            const auto = _autoLayout(nodes, edges);
            for (const [id, pos] of Object.entries(auto)) {
                if (!_positions[id]) _positions[id] = pos;
            }
            _savePositions();
        }
        _render();
    }

    async function run() {
        const btn = document.getElementById("btn-canvas-run");
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(
                `/api/engines/${_toolId}/etl/run?db=${encodeURIComponent(_dbPath)}`,
                { method: "POST" }
            );
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();
            _showToast(`ETL run complete — ${data.created ?? 0} created, ${data.updated ?? 0} updated.`, "success");
        } catch (err) {
            _showToast("Run failed: " + err.message, "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function _showToast(msg, type = "info") {
        if (typeof Utils !== "undefined" && Utils.showToast) {
            Utils.showToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    }


    return { init, run };

})();
