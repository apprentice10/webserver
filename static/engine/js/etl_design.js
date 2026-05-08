/**
 * static/engine/js/etl_design.js
 * --------------------------------
 * ETL Design canvas — project-level DAG view.
 * Shows all tools as draggable node cards with directed edges for ETL
 * dependencies. Supports pan, zoom, bulk run-stale and run-all.
 */

const EtlDesign = (() => {

    // ── State ─────────────────────────────────────────────────────────────

    let _dbPath = null;
    let _graph     = { nodes: [], edges: [] };
    let _positions = {};   // { slug: {x, y} }
    let _pan       = { x: 40, y: 40 };
    let _zoom      = 1.0;

    // Drag state
    let _panActive    = false;
    let _panStart     = null;
    let _panOrigin    = null;
    let _dragNode     = null;   // slug being dragged
    let _dragStart    = null;   // {mx, my} mouse at drag start
    let _dragOrigin   = null;   // {x, y} position at drag start
    let _dragMoved    = false;

    const NODE_W = 190;
    const NODE_H = 52;


    // ── localStorage ──────────────────────────────────────────────────────

    function _posKey() {
        let h = 5381;
        const s = _dbPath || '';
        for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
        return `instrumentManager.etlDesign.${h.toString(36)}.positions`;
    }

    function _loadPositions() {
        try {
            const raw = localStorage.getItem(_posKey());
            _positions = raw ? JSON.parse(raw) : {};
        } catch (_) {
            _positions = {};
        }
    }

    function _savePositions() {
        try {
            localStorage.setItem(_posKey(), JSON.stringify(_positions));
        } catch (_) {}
    }


    // ── Fetch ──────────────────────────────────────────────────────────────

    async function _fetchGraph() {
        const res = await fetch(`/api/project/etl-graph?db=${encodeURIComponent(_dbPath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function _postRun(endpoint) {
        const res = await fetch(`/api/project/${endpoint}?db=${encodeURIComponent(_dbPath)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try { detail = (await res.json()).detail || detail; } catch (_) {}
            throw new Error(detail);
        }
        return res.json();
    }


    // ── Auto-layout ───────────────────────────────────────────────────────

    function _autoLayout(nodes, edges) {
        // Build incoming-edge count and adjacency per node slug
        const inDeg = {};
        const children = {};
        for (const n of nodes) { inDeg[n.slug] = 0; children[n.slug] = []; }
        for (const e of edges) {
            if (inDeg[e.to_slug] !== undefined) inDeg[e.to_slug]++;
            if (children[e.from_slug]) children[e.from_slug].push(e.to_slug);
        }

        // BFS to assign layers
        const layers = {};  // slug → layer index
        const queue  = nodes.filter(n => inDeg[n.slug] === 0).map(n => n.slug);
        for (const s of queue) layers[s] = 0;

        let head = 0;
        while (head < queue.length) {
            const slug = queue[head++];
            for (const child of (children[slug] || [])) {
                layers[child] = Math.max(layers[child] ?? 0, (layers[slug] ?? 0) + 1);
                if (!queue.includes(child)) queue.push(child);
            }
        }

        // Nodes not reachable from roots get layer 0
        for (const n of nodes) {
            if (layers[n.slug] === undefined) layers[n.slug] = 0;
        }

        // Group nodes by layer and sort by name within layer
        const byLayer = {};
        for (const n of nodes) {
            const l = layers[n.slug];
            (byLayer[l] = byLayer[l] || []).push(n);
        }
        for (const l of Object.keys(byLayer)) {
            byLayer[l].sort((a, b) => a.name.localeCompare(b.name));
        }

        // Assign positions
        const layerX   = 60;
        const layerGap = 260;
        const nodeGap  = 90;

        const positions = {};
        for (const [l, group] of Object.entries(byLayer)) {
            const x = layerX + Number(l) * layerGap;
            const totalH = group.length * NODE_H + (group.length - 1) * nodeGap;
            let y = 60 + Math.max(0, (500 - totalH) / 2);
            for (const n of group) {
                positions[n.slug] = { x, y };
                y += NODE_H + nodeGap;
            }
        }
        return positions;
    }


    // ── Render ────────────────────────────────────────────────────────────

    function _applyTransform() {
        const inner = document.getElementById("etl-canvas-inner");
        if (inner) {
            inner.style.transform = `translate(${_pan.x}px,${_pan.y}px) scale(${_zoom})`;
        }
    }

    function _statusClass(node) {
        if (!node.has_etl) return "etl-node--none";
        return node.is_stale ? "etl-node--stale" : "etl-node--ok";
    }

    function _badge(node) {
        if (!node.has_etl) return "—";
        return node.is_stale ? "⚠" : "✓";
    }

    function _renderNodes() {
        const layer = document.getElementById("etl-nodes-layer");
        if (!layer) return;

        layer.innerHTML = _graph.nodes.map(n => {
            const pos = _positions[n.slug] || { x: 60, y: 60 };
            return `<div class="etl-node ${_statusClass(n)}"
                        data-slug="${_esc(n.slug)}"
                        data-id="${n.id}"
                        style="left:${pos.x}px;top:${pos.y}px;">
                <div class="etl-node-icon">${_esc(n.icon)}</div>
                <div class="etl-node-body">
                    <div class="etl-node-name">${_esc(n.name)}</div>
                    <div class="etl-node-type">${_esc(n.tool_type)}</div>
                </div>
                <div class="etl-node-badge">${_badge(n)}</div>
            </div>`;
        }).join("");

        // Attach drag listeners to each node
        for (const el of layer.querySelectorAll(".etl-node")) {
            _initNodeDrag(el);
        }
    }

    function _renderEdges() {
        const svg = document.getElementById("etl-edges-svg");
        if (!svg) return;

        // Remove old paths (keep defs)
        svg.querySelectorAll("path.etl-edge").forEach(p => p.remove());

        for (const edge of _graph.edges) {
            const fromPos = _positions[edge.from_slug];
            const toPos   = _positions[edge.to_slug];
            if (!fromPos || !toPos) continue;

            const fromNode = _graph.nodes.find(n => n.slug === edge.from_slug);
            const isStale  = fromNode?.is_stale;

            // Anchor: right-center of source, left-center of target
            const x0 = fromPos.x + NODE_W;
            const y0 = fromPos.y + NODE_H / 2;
            const x1 = toPos.x;
            const y1 = toPos.y + NODE_H / 2;
            const cx = Math.abs(x1 - x0) * 0.5 + 40;

            const d = `M${x0},${y0} C${x0+cx},${y0} ${x1-cx},${y1} ${x1},${y1}`;
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("class", isStale ? "etl-edge etl-edge--stale" : "etl-edge");
            svg.appendChild(path);
        }
    }

    function _render() {
        const hint = document.getElementById("etl-empty-hint");
        if (hint) hint.style.display = _graph.nodes.length === 0 ? "" : "none";
        _renderNodes();
        _renderEdges();
        _applyTransform();
    }

    function _esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // Update only status classes and badges without full re-render (keeps positions)
    function _updateNodeStates() {
        const layer = document.getElementById("etl-nodes-layer");
        if (!layer) return;
        for (const n of _graph.nodes) {
            const el = layer.querySelector(`[data-slug="${CSS.escape(n.slug)}"]`);
            if (!el) continue;
            el.className = `etl-node ${_statusClass(n)}`;
            const badge = el.querySelector(".etl-node-badge");
            if (badge) badge.textContent = _badge(n);
        }
        _renderEdges();
    }


    // ── Node drag ─────────────────────────────────────────────────────────

    function _initNodeDrag(el) {
        el.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const slug = el.dataset.slug;
            const pos  = _positions[slug] || { x: 0, y: 0 };
            _dragNode   = slug;
            _dragStart  = { mx: e.clientX, my: e.clientY };
            _dragOrigin = { x: pos.x, y: pos.y };
            _dragMoved  = false;
            document.getElementById("etl-canvas-wrap")?.classList.add("dragging");
        });

        el.addEventListener("click", e => {
            if (_dragMoved) { e.stopPropagation(); e.preventDefault(); return; }
            const id = el.dataset.id;
            if (e.ctrlKey || e.metaKey) {
                window.location.href = `/etl?db=${encodeURIComponent(_dbPath)}&tool=${id}`;
            } else if (e.shiftKey) {
                window.location.href = `/tool?db=${encodeURIComponent(_dbPath)}&tool=${id}`;
            } else {
                window.location.href = `/canvas?db=${encodeURIComponent(_dbPath)}&tool=${id}`;
            }
        });
    }


    // ── Canvas pan + zoom ─────────────────────────────────────────────────

    function _initCanvas() {
        const wrap = document.getElementById("etl-canvas-wrap");
        if (!wrap) return;

        // Pan start
        wrap.addEventListener("mousedown", e => {
            if (e.button !== 0 || e.target.closest(".etl-node")) return;
            _panActive = true;
            _panStart  = { mx: e.clientX, my: e.clientY };
            _panOrigin = { x: _pan.x, y: _pan.y };
            wrap.classList.add("panning");
        });

        // Mousemove — pan or node drag
        window.addEventListener("mousemove", e => {
            if (_dragNode) {
                const dx = (e.clientX - _dragStart.mx) / _zoom;
                const dy = (e.clientY - _dragStart.my) / _zoom;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _dragMoved = true;
                _positions[_dragNode] = {
                    x: _dragOrigin.x + dx,
                    y: _dragOrigin.y + dy,
                };
                const el = document.querySelector(`[data-slug="${CSS.escape(_dragNode)}"]`);
                if (el) {
                    el.style.left = _positions[_dragNode].x + "px";
                    el.style.top  = _positions[_dragNode].y + "px";
                }
                _renderEdges();
                return;
            }
            if (!_panActive) return;
            _pan.x = _panOrigin.x + (e.clientX - _panStart.mx);
            _pan.y = _panOrigin.y + (e.clientY - _panStart.my);
            _applyTransform();
        });

        // Mouseup
        window.addEventListener("mouseup", () => {
            if (_dragNode) {
                _savePositions();
                _dragNode = null;
                document.getElementById("etl-canvas-wrap")?.classList.remove("dragging");
            }
            if (_panActive) {
                _panActive = false;
                wrap.classList.remove("panning");
            }
        });

        // Zoom via wheel
        wrap.addEventListener("wheel", e => {
            e.preventDefault();
            const rect  = wrap.getBoundingClientRect();
            const mx    = e.clientX - rect.left;
            const my    = e.clientY - rect.top;
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZ  = Math.min(3.0, Math.max(0.3, _zoom * delta));
            // Adjust pan to keep mouse point stationary
            _pan.x = mx - (mx - _pan.x) * (newZ / _zoom);
            _pan.y = my - (my - _pan.y) * (newZ / _zoom);
            _zoom  = newZ;
            _applyTransform();
        }, { passive: false });
    }


    // ── Project name in crumbs ────────────────────────────────────────────

    async function _loadProjectName() {
        try {
            const proj = await fetch(`/api/project?db=${encodeURIComponent(_dbPath)}`).then(r => r.json());
            const el = document.getElementById("project-name");
            if (el) el.textContent = proj.name || "Project";
        } catch (_) {}
    }


    // ── Public API ────────────────────────────────────────────────────────

    async function init(dbPath) {
        _dbPath = dbPath;
        _loadPositions();
        _initCanvas();
        _loadProjectName();
        try {
            _graph = await _fetchGraph();
            // Auto-layout only for nodes missing saved positions
            const needsLayout = _graph.nodes.some(n => !_positions[n.slug]);
            if (needsLayout) {
                const auto = _autoLayout(_graph.nodes, _graph.edges);
                for (const [slug, pos] of Object.entries(auto)) {
                    if (!_positions[slug]) _positions[slug] = pos;
                }
                _savePositions();
            }
        } catch (err) {
            _showToast("Failed to load ETL graph: " + err.message, "error");
            _graph = { nodes: [], edges: [] };
        }
        _render();
    }

    async function refresh() {
        try {
            _graph = await _fetchGraph();
            _updateNodeStates();
        } catch (err) {
            _showToast("Refresh failed: " + err.message, "error");
        }
    }

    async function runStale() {
        _setButtons(true);
        try {
            const data = await _postRun("etl-run-stale");
            const ok  = data.results.filter(r => !r.error);
            const bad = data.results.filter(r =>  r.error);
            if (ok.length)  _showToast(`${ok.length} tool(s) updated successfully.`, "success");
            if (bad.length) _showToast(`${bad.length} tool(s) failed: ${bad.map(r => r.name).join(", ")}`, "error");
            await refresh();
        } catch (err) {
            _showToast("Run failed: " + err.message, "error");
        } finally {
            _setButtons(false);
        }
    }

    async function runAll() {
        _setButtons(true);
        try {
            const data = await _postRun("etl-run-all");
            const ok  = data.results.filter(r => !r.error);
            const bad = data.results.filter(r =>  r.error);
            if (ok.length)  _showToast(`${ok.length} tool(s) ran successfully.`, "success");
            if (bad.length) _showToast(`${bad.length} tool(s) failed: ${bad.map(r => r.name).join(", ")}`, "error");
            await refresh();
        } catch (err) {
            _showToast("Run failed: " + err.message, "error");
        } finally {
            _setButtons(false);
        }
    }


    // ── Helpers ───────────────────────────────────────────────────────────

    function _setButtons(disabled) {
        for (const id of ["btn-run-stale", "btn-run-all", "btn-etl-refresh"]) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = disabled;
        }
    }

    function _showToast(msg, type = "info") {
        if (typeof Utils !== "undefined" && Utils.showToast) {
            Utils.showToast(msg, type);
            return;
        }
        // Fallback if Utils not available
        console.log(`[${type}] ${msg}`);
    }


    return { init, refresh, runStale, runAll };

})();
