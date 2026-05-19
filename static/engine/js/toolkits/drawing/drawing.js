/**
 * toolkits/drawing/drawing.js
 * ----------------------------
 * Updated: 2026-05-20 11:00
 * Drawing Toolkit IIFE.
 * Attaches annotated engineering drawings (P&IDs, layouts, datasheets) to a
 * tool instance. Manages image gallery, SVG annotation overlay, and cross-toolkit
 * events. Image upload and annotation persistence are engine-level backend concerns
 * (D-DRW-01); this toolkit is purely frontend.
 *
 * Called by ToolkitHost as: Drawing.init(ctx, decl)
 * Coordinate system: normalized 0.0–1.0 (D-DRW-06).
 * Shape types: pin | arrow | rectangle | text (D-DRW-07).
 */
const Drawing = (() => {

    // --- STATE ---

    let _ctx           = null;
    let _id            = 'drawing';
    let _config        = null;

    // Engine identity (resolved at init)
    let _slug          = null;
    let _toolId        = null;
    let _db            = null;

    // Gallery state
    let _images        = [];        // [{ id, name, mime_type, source_width, source_height, created_at }]
    let _activeImageId = null;

    // Annotation state (Step 8)
    let _annotations   = [];        // [{ id, image_id, type, style, page, row_key, ...coords }]

    // Canvas interaction state (Steps 9–10)
    let _mode          = 'select';  // 'select' | 'pin' | 'arrow' | 'rectangle' | 'text'
    let _drawStart     = null;      // { x, y } normalized start point of current draw gesture
    let _dragState     = null;      // { annId, svgEl, startNorm, origProps } during annotation drag

    // Zoom/pan state (Step 6)
    let _zoom = 1.0; let _panX = 0; let _panY = 0; let _panStart = null;

    // PDF page state (Step 7 — D-DRW-12)
    let _activePage    = 1;         // 1-based, transient UI state
    let _pdfDoc        = null;      // loaded pdf.js document object
    let _pdfTotalPages = 0;

    // Default per-type colors (D-DRW-09: annotation.style ?? _styles[type] ?? these)
    const _defaultColors = { pin: '#e74c3c', arrow: '#2980b9', rectangle: '#27ae60', text: '#2c3e50' };

    // Cross-toolkit highlight state (Step 11 — D-DRW-11)
    let _selectedRowKey = null;

    // Per-type style presets (Step 11 — D-DRW-09): mutable local copy of toolkit_config.drawing.styles
    let _styles = {};

    // Panel body element (set by onActivate each time the panel becomes visible)
    let _panelEl       = null;


    // --- INIT ---

    function init(ctx, decl) {
        _ctx    = ctx;
        _id     = decl?.id ?? 'drawing';
        _config = ctx.config[_id] ?? {};
        _styles = Object.assign({}, _config?.styles ?? {});

        const engine = ctx.engine;
        _slug   = engine.slug;
        _toolId = engine.toolInstanceId;
        _db     = engine.dbPath;

        ctx.on('grid:rowSelected', _onGridRowSelected);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _mountPanel);
        } else {
            _mountPanel();
        }

        return { openPanel, setMode, getActiveImage, getAnnotations };
    }


    // --- PANEL MOUNT ---

    function _mountPanel() {
        _injectCss();
        PanelSystem.register({
            id:         _id,
            title:      'Drawings',
            icon:       '📐',
            onActivate: body => { _panelEl = body; _renderPanel(body); }
        });
        if (!PanelSystem.isPanelOpen(_id)) {
            if (_config.displayMode === 'docked') PanelSystem.showPanel(_id);
            else PanelSystem.moveToFloat(_id, 80, 120);
        }
    }

    function openPanel() {
        PanelSystem.showPanel(_id);
    }

    function _injectCss() {
        if (document.getElementById('drw-styles')) return;
        const link = document.createElement('link');
        link.id   = 'drw-styles';
        link.rel  = 'stylesheet';
        link.href = '/static/engine/js/toolkits/drawing/drawing.css';
        document.head.appendChild(link);
    }

    function _renderPanel(body) {
        _panelEl = body;
        body.innerHTML = `
            <div class="drw-panel">
                <div class="drw-header">
                    <button class="drw-upload-btn">+ Upload</button>
                    <input class="drw-file-input" type="file" accept=".svg,.png,.jpg,.jpeg,.pdf" hidden>
                    <div class="drw-zoom-controls">
                        <button class="drw-zoom-out" title="Zoom out">−</button>
                        <span class="drw-zoom-label">100%</span>
                        <button class="drw-zoom-in" title="Zoom in">+</button>
                        <button class="drw-zoom-reset" title="Reset view">⊡</button>
                    </div>
                </div>
                <div class="drw-toolbar">
                    <button class="drw-mode-btn${_mode==='select'?' active':''}" data-mode="select" title="Select / Pan">↖</button>
                    <button class="drw-mode-btn${_mode==='pin'?' active':''}" data-mode="pin" title="Add Pin">⊙</button>
                    <button class="drw-mode-btn${_mode==='arrow'?' active':''}" data-mode="arrow" title="Draw Arrow">→</button>
                    <button class="drw-mode-btn${_mode==='rectangle'?' active':''}" data-mode="rectangle" title="Draw Rectangle">□</button>
                    <button class="drw-mode-btn${_mode==='text'?' active':''}" data-mode="text" title="Add Text">T</button>
                    <span class="drw-sty-sep"></span>
                    <input type="color" class="drw-sty-color" title="Annotation color">
                    <span class="drw-sty-sw-wrap"><input type="number" class="drw-sty-sw" min="1" max="20" title="Stroke width (W)"></span>
                    <span class="drw-sty-fill-wrap"><input type="color" class="drw-sty-fill-c" title="Fill color"><input type="range" class="drw-sty-fill-op" min="0" max="1" step="0.05" title="Fill opacity"></span>
                    <span class="drw-sty-fs-wrap"><input type="number" class="drw-sty-fs" min="8" max="72" title="Font size (px)"></span>
                </div>
                <div class="drw-gallery-strip"></div>
                <div class="drw-canvas-area">
                    <p class="drw-canvas-placeholder">Select a drawing above to view it.</p>
                </div>
            </div>`;
        _attachGalleryEvents(body);
        body.querySelector('.drw-zoom-in').addEventListener('click',    () => { _zoom = Math.min(10, _zoom + 0.2); _applyZoomPan(); });
        body.querySelector('.drw-zoom-out').addEventListener('click',   () => { _zoom = Math.max(0.1, _zoom - 0.2); _applyZoomPan(); });
        body.querySelector('.drw-zoom-reset').addEventListener('click', () => { _zoom = 1; _panX = 0; _panY = 0; _applyZoomPan(); });
        body.querySelector('.drw-toolbar').addEventListener('click', e => {
            const btn = e.target.closest('.drw-mode-btn');
            if (btn) setMode(btn.dataset.mode);
        });
        body.querySelector('.drw-sty-color').addEventListener('input',  e => _onStyleInput('color',        e.target.value));
        body.querySelector('.drw-sty-sw').addEventListener('change',    e => _onStyleInput('strokeWidth',  Number(e.target.value)));
        body.querySelector('.drw-sty-fill-c').addEventListener('input', e => _onStyleInput('fillColor',    e.target.value));
        body.querySelector('.drw-sty-fill-op').addEventListener('input',e => _onStyleInput('fillOpacity',  Number(e.target.value)));
        body.querySelector('.drw-sty-fs').addEventListener('change',    e => _onStyleInput('fontSize',     Number(e.target.value)));
        _updateStyleControls(body);
        _loadImages();
    }

    function _refreshGallery() {
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        if (!body) return;
        const gallery = body.querySelector('.drw-gallery-strip');
        if (!gallery) return;
        if (!_images.length) {
            gallery.innerHTML = '<p class="drw-empty">No drawings yet. Click + Upload to add one.</p>';
            return;
        }
        gallery.innerHTML = _images.map(img => `
            <div class="drw-img-card${img.id === _activeImageId ? ' active' : ''}" data-id="${escHtml(img.id)}">
                <img class="drw-img-thumb" src="${_buildUrl('images/' + img.id + '/blob')}" alt="${escHtml(img.name)}">
                <div class="drw-img-name">${escHtml(img.name)}</div>
                <div class="drw-img-actions">
                    <button class="drw-btn-replace" title="Replace image">↺</button>
                    <input class="drw-file-replace" type="file" accept=".svg,.png,.jpg,.jpeg,.pdf" hidden>
                    <button class="drw-btn-delete" title="Delete image">✕</button>
                </div>
            </div>`).join('');
        gallery.onclick = e => {
            const card = e.target.closest('.drw-img-card');
            if (!card) return;
            const id = card.dataset.id;
            if (e.target.closest('.drw-btn-delete'))  { _deleteImage(id);                               return; }
            if (e.target.closest('.drw-btn-replace')) { card.querySelector('.drw-file-replace').click(); return; }
            _setActiveImage(id);
        };
        gallery.onchange = e => {
            const inp = e.target.closest('.drw-file-replace');
            if (!inp || !inp.files[0]) return;
            _replaceImage(inp.closest('.drw-img-card').dataset.id, inp.files[0]);
        };
    }

    function _attachGalleryEvents(body) {
        const btn = body.querySelector('.drw-upload-btn');
        const inp = body.querySelector('.drw-file-input');
        btn.addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => {
            const file = inp.files[0];
            if (!file) return;
            const name = prompt('Drawing name:', file.name.replace(/\.[^.]+$/, '')) ?? '';
            if (!name.trim()) return;
            _uploadImage(file, name.trim());
            inp.value = '';
        });
    }


    // --- IMAGE GALLERY ---

    async function _loadImages() {
        try {
            const r = await fetch(_buildUrl('images'));
            if (!r.ok) throw new Error(await r.text());
            _images = await r.json();
            if (!_activeImageId && _images.length) _activeImageId = _images[0].id;
            _refreshGallery();
        } catch (e) {
            Utils.showToast('Failed to load drawings: ' + e.message, 'error');
        }
    }

    async function _uploadImage(file, name) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', name);
        try {
            const r = await fetch(_buildUrl('images/upload'), { method: 'POST', body: fd });
            if (!r.ok) throw new Error(await r.text());
            const data = await r.json();
            _activeImageId = data.id;
            await _loadImages();
        } catch (e) {
            Utils.showToast('Upload failed: ' + e.message, 'error');
        }
    }

    async function _deleteImage(imageId) {
        if (!confirm('Delete this drawing and all its annotations? This cannot be undone.')) return;
        try {
            const r = await fetch(_buildUrl('images/' + imageId), { method: 'DELETE' });
            if (!r.ok) throw new Error(await r.text());
            if (_activeImageId === imageId) _activeImageId = null;
            await _loadImages();
        } catch (e) {
            Utils.showToast('Delete failed: ' + e.message, 'error');
        }
    }

    async function _replaceImage(imageId, file) {
        if (!confirm('Replace this drawing? Annotation positions are preserved but may drift if the new image has different geometry.')) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch(_buildUrl('images/' + imageId), { method: 'PATCH', body: fd });
            if (!r.ok) throw new Error(await r.text());
            await _loadImages();
        } catch (e) {
            Utils.showToast('Replace failed: ' + e.message, 'error');
        }
    }

    function _setActiveImage(imageId) {
        _activeImageId = imageId;
        _activePage    = 1;
        _pdfDoc        = null;
        _refreshGallery();
        _renderCanvas();
    }

    function getActiveImage() {
        return _images.find(img => img.id === _activeImageId) ?? null;
    }


    // --- CANVAS RENDERING (Step 6) ---

    function _renderCanvas() {
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        if (!body) return;
        const area = body.querySelector('.drw-canvas-area');
        if (!area) return;
        const imgRec = getActiveImage();
        if (!imgRec) { area.innerHTML = '<p class="drw-canvas-placeholder">Select a drawing above to view it.</p>'; return; }
        _zoom = 1.0; _panX = 0; _panY = 0;
        if (imgRec.mime_type === 'application/pdf') { _renderCanvasPdf(area, imgRec); return; }
        area.innerHTML = `<div class="drw-canvas-viewport"><div class="drw-canvas-inner"><img class="drw-canvas-img" src="${_buildUrl('images/' + imgRec.id + '/blob')}" alt="${escHtml(imgRec.name)}" draggable="false"><svg class="drw-canvas-svg" xmlns="http://www.w3.org/2000/svg"></svg></div></div>`;
        const viewport = area.querySelector('.drw-canvas-viewport');
        const svgEl    = area.querySelector('.drw-canvas-svg');
        const imgEl    = area.querySelector('.drw-canvas-img');
        imgEl.addEventListener('load', () => {
            const w = imgEl.naturalWidth || imgEl.width, h = imgEl.naturalHeight || imgEl.height;
            svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`); svgEl.setAttribute('width', w); svgEl.setAttribute('height', h);
            _applyZoomPan(body);
            _loadAnnotations();
        });
        _bindZoomPan(viewport, body);
    }

    // Applies current _zoom/_panX/_panY as a CSS transform to .drw-canvas-inner.
    // SVG lives inside the same transform target → alignment never drifts (D-DRW-06 risk).
    function _applyZoomPan(body) {
        const b = body || _panelEl || PanelSystem.getPanelBody(_id);
        if (!b) return;
        const inner = b.querySelector('.drw-canvas-inner');
        if (inner) inner.style.transform = `translate(${_panX}px,${_panY}px) scale(${_zoom})`;
        const lbl = b.querySelector('.drw-zoom-label');
        if (lbl) lbl.textContent = Math.round(_zoom * 100) + '%';
    }

    function _bindZoomPan(viewport, body) {
        viewport.style.cursor = _mode === 'select' ? 'grab' : 'crosshair';
        viewport.addEventListener('wheel', e => {
            e.preventDefault();
            _zoom = Math.max(0.1, Math.min(10, _zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
            _applyZoomPan(body);
        }, { passive: false });
        viewport.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            viewport.setPointerCapture(e.pointerId);
            if (_mode === 'select') {
                _panStart = { x: e.clientX - _panX, y: e.clientY - _panY };
                viewport.style.cursor = 'grabbing';
            } else {
                const svgEl = body.querySelector('.drw-canvas-svg');
                _drawStart = svgEl ? _clientToNorm(svgEl, e.clientX, e.clientY) : null;
            }
        });
        viewport.addEventListener('pointermove', e => {
            if (_mode === 'select') {
                if (!_panStart) return;
                _panX = e.clientX - _panStart.x;
                _panY = e.clientY - _panStart.y;
                _applyZoomPan(body);
            } else {
                if (!_drawStart) return;
                const svgEl = body.querySelector('.drw-canvas-svg');
                if (svgEl) _updateDrawPreview(svgEl, _clientToNorm(svgEl, e.clientX, e.clientY));
            }
        });
        viewport.addEventListener('pointerup', e => {
            if (_mode === 'select') {
                _panStart = null;
                viewport.style.cursor = 'grab';
            } else if (_drawStart) {
                const svgEl = body.querySelector('.drw-canvas-svg');
                const end = svgEl ? _clientToNorm(svgEl, e.clientX, e.clientY) : _drawStart;
                _removeDrawPreview(svgEl);
                _finishDraw(_drawStart, end);
                _drawStart = null;
            }
        });
    }


    // --- PDF SUPPORT (Step 7 — D-DRW-12) ---

    // Lazy-loads pdf.js as an ES module; caches result on window to avoid double-init.
    async function _loadPdfJs() {
        if (window._drwPdfLib) return window._drwPdfLib;
        const mod = await import('/static/vendor/pdfjs/pdf.min.mjs');
        mod.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.mjs';
        window._drwPdfLib = mod;
        return mod;
    }

    async function _renderCanvasPdf(area, imgRec) {
        area.innerHTML = `<div class="drw-pdf-nav-bar"><button class="drw-pdf-prev" disabled>‹</button><span class="drw-pdf-page">…</span><button class="drw-pdf-next" disabled>›</button></div><div class="drw-pdf-canvas-wrap"><div class="drw-canvas-viewport"><div class="drw-canvas-inner"><canvas class="drw-pdf-canvas"></canvas><svg class="drw-canvas-svg" xmlns="http://www.w3.org/2000/svg"></svg></div></div></div>`;
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        _bindZoomPan(area.querySelector('.drw-canvas-viewport'), body);
        try {
            const lib = await _loadPdfJs();
            _pdfDoc = await lib.getDocument(_buildUrl('images/' + imgRec.id + '/blob')).promise;
            _pdfTotalPages = _pdfDoc.numPages;
            await _renderPdfPage(1);
            await _loadAnnotations();
        } catch (e) {
            Utils.showToast('PDF load failed: ' + e.message, 'error');
            return;
        }
        area.querySelector('.drw-pdf-prev').addEventListener('click', () => _setActivePage(_activePage - 1));
        area.querySelector('.drw-pdf-next').addEventListener('click', () => _setActivePage(_activePage + 1));
    }

    async function _renderPdfPage(page) {
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        if (!body || !_pdfDoc) return;
        const canvas = body.querySelector('.drw-pdf-canvas'), svgEl = body.querySelector('.drw-canvas-svg');
        if (!canvas) return;
        const pg = await _pdfDoc.getPage(page);
        const vp = pg.getViewport({ scale: 2.0 });
        canvas.width = vp.width; canvas.height = vp.height;
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (svgEl) { svgEl.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`); svgEl.setAttribute('width', vp.width); svgEl.setAttribute('height', vp.height); }
        const lbl = body.querySelector('.drw-pdf-page');
        if (lbl) lbl.textContent = `${page} / ${_pdfTotalPages}`;
        const prev = body.querySelector('.drw-pdf-prev'), next = body.querySelector('.drw-pdf-next');
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= _pdfTotalPages;
        _applyZoomPan(body);
    }

    async function _setActivePage(page) {
        if (page < 1 || page > _pdfTotalPages) return;
        _activePage = page;
        await _renderPdfPage(page);
        _renderAnnotations();
    }


    // --- ANNOTATION RENDERING (Step 8) ---

    async function _loadAnnotations() {
        if (!_activeImageId) return;
        try {
            const r = await fetch(_buildUrl('images/' + _activeImageId + '/annotations'));
            if (!r.ok) throw new Error(await r.text());
            _annotations = await r.json();
            _renderAnnotations();
        } catch (e) {
            Utils.showToast('Failed to load annotations: ' + e.message, 'error');
        }
    }

    function _renderAnnotations() {
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        if (!body) return;
        const svgEl = body.querySelector('.drw-canvas-svg');
        if (!svgEl) return;
        const W = parseFloat(svgEl.getAttribute('width')  || 0);
        const H = parseFloat(svgEl.getAttribute('height') || 0);
        if (!W || !H) return;

        let layer = svgEl.querySelector('.drw-ann-layer');
        if (layer) layer.remove();
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('class', 'drw-ann-layer');
        svgEl.appendChild(layer);

        // For PDF: only show annotations matching the current page (D-DRW-12).
        const visible = _annotations.filter(a =>
            _pdfDoc ? (a.page == null || a.page === _activePage) : true
        );
        layer.innerHTML = visible.map(a => _renderAnnotationSvg(a, W, H)).join('');

        layer.querySelectorAll('.drw-ann-shape').forEach(el => {
            if (_selectedRowKey) {
                if (el.dataset.rowKey === _selectedRowKey) el.classList.add('drw-highlighted');
                else el.classList.add('drw-dimmed');
            }
            el.addEventListener('click', e => {
                e.stopPropagation();
                const rowKey = el.dataset.rowKey || null;
                _selectedRowKey = rowKey;
                _renderAnnotations();
                _emitAnnotationSelected(rowKey);
            });
            el.addEventListener('pointerdown', e => _onAnnotationPointerDown(e, el.dataset.annId, svgEl));
        });
    }

    // Returns an SVG string for one annotation. Resolves style per D-DRW-09:
    // annotation.style takes precedence, then toolkit config preset, then hardcoded default.
    function _renderAnnotationSvg(ann, W, H) {
        const preset  = _styles[ann.type] ?? {};
        const style   = Object.assign({}, preset, ann.style ?? {});
        const color   = style.color       || _defaultColors[ann.type] || '#888';
        const sw      = style.strokeWidth ?? 2;
        const rowKey  = ann.row_key || '';
        const gAttr   = `class="drw-ann-shape" data-ann-id="${escHtml(ann.id)}" data-row-key="${escHtml(rowKey)}" style="cursor:pointer;pointer-events:all"`;
        const p       = ann.props || {};

        if (ann.type === 'pin') {
            const cx = (p.x ?? 0) * W, cy = (p.y ?? 0) * H;
            const label = escHtml(p.label ?? '');
            return `<g ${gAttr}>
  <circle cx="${cx}" cy="${cy}" r="9" fill="${escHtml(color)}" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>
  <circle cx="${cx}" cy="${cy}" r="3.5" fill="white"/>
  <text x="${cx}" y="${cy + 21}" text-anchor="middle" fill="${escHtml(color)}" font-size="11" font-weight="600" paint-order="stroke" stroke="white" stroke-width="3">${label}</text>
</g>`;
        }

        if (ann.type === 'arrow') {
            const x1 = (p.x1 ?? 0) * W, y1 = (p.y1 ?? 0) * H;
            const x2 = (p.x2 ?? 0.1) * W, y2 = (p.y2 ?? 0) * H;
            const mid = 'drw-ah-' + ann.id.replace(/-/g, '');
            return `<g ${gAttr}>
  <defs><marker id="${mid}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0 8 3 0 6" fill="${escHtml(color)}"/></marker></defs>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escHtml(color)}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#${mid})"/>
</g>`;
        }

        if (ann.type === 'rectangle') {
            const rx = (p.x ?? 0) * W, ry = (p.y ?? 0) * H;
            const rw = (p.w ?? 0.1) * W, rh = (p.h ?? 0.1) * H;
            const fill    = style.fillColor   ?? 'none';
            const fillOp  = style.fillOpacity ?? 0;
            return `<g ${gAttr}>
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${escHtml(fill)}" fill-opacity="${fillOp}" stroke="${escHtml(color)}" stroke-width="${sw}" rx="2"/>
</g>`;
        }

        if (ann.type === 'text') {
            const tx = (p.x ?? 0) * W, ty = (p.y ?? 0) * H;
            const fs   = style.fontSize ?? 14;
            const text = escHtml(p.text ?? '');
            return `<g ${gAttr}>
  <text x="${tx}" y="${ty}" fill="${escHtml(color)}" font-size="${fs}" paint-order="stroke" stroke="white" stroke-width="3">${text}</text>
</g>`;
        }

        return '';
    }

    function getAnnotations() { return _annotations.slice(); }


    // --- TOOL MODE + ANNOTATION CREATION (Step 9) ---

    function setMode(mode) {
        _mode = mode;
        const body = _panelEl || PanelSystem.getPanelBody(_id);
        if (!body) return;
        body.querySelectorAll('.drw-mode-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.mode === mode));
        const vp = body.querySelector('.drw-canvas-viewport');
        if (vp) vp.style.cursor = mode === 'select' ? 'grab' : 'crosshair';
        // In draw modes, force the SVG overlay to pass through all pointer events so
        // the viewport receives the draw gesture. In select mode, remove the override
        // so individual shapes (pointer-events:all) handle their own click events.
        const svgEl = body.querySelector('.drw-canvas-svg');
        if (svgEl) svgEl.style.pointerEvents = mode === 'select' ? '' : 'none';
        _updateStyleControls(body);
    }

    // Convert client coords to normalized [0,1] SVG space.
    // getBoundingClientRect accounts for zoom/pan transform so dividing by rendered
    // rect width/height gives the normalized position directly (D-DRW-06).
    function _clientToNorm(svgEl, clientX, clientY) {
        const r = svgEl.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (clientY - r.top)  / r.height))
        };
    }

    // Shows a dashed rubber-band preview for arrow/rectangle during drag.
    function _updateDrawPreview(svgEl, cur) {
        if (!_drawStart || !svgEl) return;
        _removeDrawPreview(svgEl);
        const W = parseFloat(svgEl.getAttribute('width')  || 1);
        const H = parseFloat(svgEl.getAttribute('height') || 1);
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        el.setAttribute('class', 'drw-preview');
        el.setAttribute('pointer-events', 'none');
        const color = _styles[_mode]?.color || _defaultColors[_mode] || '#888';
        if (_mode === 'arrow') {
            el.innerHTML = `<line x1="${_drawStart.x*W}" y1="${_drawStart.y*H}" x2="${cur.x*W}" y2="${cur.y*H}" stroke="${color}" stroke-width="2" stroke-dasharray="6 3" opacity="0.8"/>`;
        } else if (_mode === 'rectangle') {
            const rx = Math.min(_drawStart.x,cur.x)*W, ry = Math.min(_drawStart.y,cur.y)*H;
            el.innerHTML = `<rect x="${rx}" y="${ry}" width="${Math.abs(cur.x-_drawStart.x)*W}" height="${Math.abs(cur.y-_drawStart.y)*H}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="6 3" opacity="0.8"/>`;
        }
        svgEl.appendChild(el);
    }

    function _removeDrawPreview(svgEl) {
        if (!svgEl) return;
        const prev = svgEl.querySelector('.drw-preview');
        if (prev) prev.remove();
    }

    // Completes a draw gesture: prompts for label/text, then POSTs the annotation.
    async function _finishDraw(start, end) {
        const page = _pdfDoc ? _activePage : null;
        if (_mode === 'pin') {
            const label = (prompt('Pin label (e.g. FT-101):') ?? '').trim();
            if (!label) return;
            await _createAnnotation({ type: 'pin', page, row_key: label, props: { x: start.x, y: start.y, label } });
        } else if (_mode === 'arrow') {
            await _createAnnotation({ type: 'arrow', page, props: { x1: start.x, y1: start.y, x2: end.x, y2: end.y } });
        } else if (_mode === 'rectangle') {
            const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
            if (w < 0.005 || h < 0.005) return;
            await _createAnnotation({ type: 'rectangle', page, props: { x: Math.min(start.x,end.x), y: Math.min(start.y,end.y), w, h } });
        } else if (_mode === 'text') {
            const text = (prompt('Text:') ?? '').trim();
            if (!text) return;
            await _createAnnotation({ type: 'text', page, props: { x: start.x, y: start.y, text } });
        }
    }

    async function _createAnnotation(payload) {
        if (!_activeImageId) return;
        try {
            const r = await fetch(_buildUrl('images/' + _activeImageId + '/annotations'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) throw new Error(await r.text());
            const ann = await r.json();
            _annotations.push(ann);
            _renderAnnotations();
        } catch (e) {
            Utils.showToast('Failed to create annotation: ' + e.message, 'error');
        }
    }


    // --- ANNOTATION DRAG-TO-MOVE (Step 10) ---

    function _onAnnotationPointerDown(e, annId, svgEl) {
        if (_mode !== 'select') return;
        e.stopPropagation();  // prevent viewport pan from firing

        const ann = _annotations.find(a => a.id === annId);
        if (!ann) return;

        _dragState = {
            annId,
            svgEl,
            startNorm: _clientToNorm(svgEl, e.clientX, e.clientY),
            origProps: JSON.parse(JSON.stringify(ann.props))
        };

        const shape = e.currentTarget;
        shape.setPointerCapture(e.pointerId);
        shape.style.cursor = 'grabbing';

        function onMove(ev) {
            if (!_dragState) return;
            const cur = _clientToNorm(_dragState.svgEl, ev.clientX, ev.clientY);
            const dx = cur.x - _dragState.startNorm.x;
            const dy = cur.y - _dragState.startNorm.y;
            const W  = parseFloat(_dragState.svgEl.getAttribute('width')  || 1);
            const H  = parseFloat(_dragState.svgEl.getAttribute('height') || 1);
            // Translate the whole shape group visually; re-render happens on drop (D-DRW-06).
            shape.setAttribute('transform', `translate(${dx*W},${dy*H})`);
        }

        async function onUp(ev) {
            shape.removeEventListener('pointermove', onMove);
            shape.style.cursor = 'pointer';

            const cur  = _clientToNorm(_dragState.svgEl, ev.clientX, ev.clientY);
            const dx   = cur.x - _dragState.startNorm.x;
            const dy   = cur.y - _dragState.startNorm.y;
            const state = _dragState;
            _dragState  = null;

            if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
                // Treat as a click — restore the shape (no PATCH needed).
                shape.removeAttribute('transform');
                return;
            }
            const a = _annotations.find(a => a.id === state.annId);
            if (!a) return;
            await _moveAnnotation(state.annId, _shiftProps(a.type, state.origProps, dx, dy));
        }

        shape.addEventListener('pointermove', onMove);
        shape.addEventListener('pointerup',   onUp, { once: true });
    }

    // Returns a copy of props shifted by (dx, dy) in normalized space.
    function _shiftProps(type, props, dx, dy) {
        const p = { ...props };
        const clamp = v => Math.max(0, Math.min(1, v));
        if (type === 'pin' || type === 'text') {
            p.x = clamp((p.x ?? 0) + dx);
            p.y = clamp((p.y ?? 0) + dy);
        } else if (type === 'arrow') {
            p.x1 = clamp((p.x1 ?? 0) + dx);  p.y1 = clamp((p.y1 ?? 0) + dy);
            p.x2 = clamp((p.x2 ?? 0) + dx);  p.y2 = clamp((p.y2 ?? 0) + dy);
        } else if (type === 'rectangle') {
            p.x = clamp((p.x ?? 0) + dx);
            p.y = clamp((p.y ?? 0) + dy);
        }
        return p;
    }

    async function _moveAnnotation(annId, newProps) {
        try {
            const r = await fetch(_buildUrl('images/' + _activeImageId + '/annotations/' + annId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ props: newProps })
            });
            if (!r.ok) throw new Error(await r.text());
            const ann = _annotations.find(a => a.id === annId);
            if (ann) ann.props = newProps;
        } catch (e) {
            Utils.showToast('Failed to move annotation: ' + e.message, 'error');
            await _loadAnnotations();  // resync on failure
        } finally {
            _renderAnnotations();
        }
    }


    // --- CROSS-TOOLKIT EVENTS (Step 11 — D-DRW-11) ---

    function _onGridRowSelected({ rowKey }) {
        _selectedRowKey = rowKey || null;
        _renderAnnotations();
    }

    function _emitAnnotationSelected(rowKey) {
        if (rowKey) _ctx.emit('drawing:annotationSelected', { rowKey });
    }


    // --- STYLE PRESETS (Step 11 — D-DRW-09) ---

    // Sync style control inputs to _styles[_mode] and show/hide per-mode controls.
    function _updateStyleControls(body) {
        const b = body || _panelEl || PanelSystem.getPanelBody(_id);
        if (!b) return;
        const s        = _styles[_mode] ?? {};
        const isSelect = _mode === 'select';
        const hasSW    = _mode === 'arrow' || _mode === 'rectangle';
        const hasFill  = _mode === 'rectangle';
        const hasFs    = _mode === 'text';

        const colorEl  = b.querySelector('.drw-sty-color');
        const swWrap   = b.querySelector('.drw-sty-sw-wrap');
        const fillWrap = b.querySelector('.drw-sty-fill-wrap');
        const fsWrap   = b.querySelector('.drw-sty-fs-wrap');
        const sepEl    = b.querySelector('.drw-sty-sep');

        if (sepEl)    sepEl.style.display   = isSelect ? 'none' : '';
        if (colorEl)  { colorEl.style.display  = isSelect ? 'none' : ''; colorEl.value  = s.color ?? _defaultColors[_mode] ?? '#888888'; }
        if (swWrap)   { swWrap.style.display    = hasSW   ? '' : 'none'; swWrap.querySelector('.drw-sty-sw').value = s.strokeWidth ?? 2; }
        if (fillWrap) { fillWrap.style.display  = hasFill ? '' : 'none'; fillWrap.querySelector('.drw-sty-fill-c').value = s.fillColor ?? '#ffffff'; fillWrap.querySelector('.drw-sty-fill-op').value = s.fillOpacity ?? 0; }
        if (fsWrap)   { fsWrap.style.display    = hasFs   ? '' : 'none'; fsWrap.querySelector('.drw-sty-fs').value = s.fontSize ?? 14; }
    }

    // Called on any style input change: updates local preset, re-renders, and persists.
    function _onStyleInput(prop, value) {
        if (_mode === 'select') return;
        if (!_styles[_mode]) _styles[_mode] = {};
        _styles[_mode][prop] = value;
        _renderAnnotations();
        _saveConfig();
    }

    async function _saveConfig() {
        const url = `/api/engines/${_slug}/tools/${_toolId}/toolkit-config/${_id}?db=${encodeURIComponent(_db)}`;
        const payload = Object.assign({}, _config, { styles: _styles });
        try {
            await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn('[Drawing] Failed to save config:', e);
        }
    }


    // --- HELPERS ---

    function _buildUrl(path) {
        return `/api/engines/${_slug}/tools/${_toolId}/${path}?db=${encodeURIComponent(_db)}`;
    }


    // --- PUBLIC API ---

    return { init };

})();
