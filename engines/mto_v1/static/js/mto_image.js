/* MTO image panel — upload, render (SVG/PDF/DXF), pan/zoom for SVG. */
const MtoImage = (() => {
    let _toolId = null, _db = null;

    function _param() { return `db=${encodeURIComponent(_db)}`; }
    function _imgUrl(tid) { return `/api/engines/mto/${_toolId}/images/${tid}?${_param()}`; }
    function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    async function _meta(typicalId) {
        const res = await fetch(`/api/engines/mto/${_toolId}/images/${typicalId}/meta?${_param()}`);
        if (!res.ok) return { exists: false };
        return res.json();
    }

    function _bindUpload(input, typicalId, container) {
        input.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(`/api/engines/mto/${_toolId}/images/${typicalId}?${_param()}`, {
                method: 'POST', body: fd
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                if (typeof Utils !== 'undefined') Utils.showToast(d.detail || 'Upload failed', 'error');
                return;
            }
            await load(_toolId, typicalId, _db, container);
        });
    }

    function _renderEmpty(container, typicalId) {
        container.innerHTML =
            '<div class="mto-img-empty">' +
            '<p class="mto-img-hint">No image. Upload SVG, PDF, or DXF.</p>' +
            '<label class="btn btn-ghost btn-sm">' +
            '↑ Upload image' +
            '<input type="file" accept=".svg,.dxf,.pdf" style="display:none" class="mto-img-file">' +
            '</label>' +
            '</div>';
        _bindUpload(container.querySelector('.mto-img-file'), typicalId, container);
    }

    function _initPanZoom(viewport, xform) {
        let scale = 1, tx = 0, ty = 0;
        let drag = false, ox, oy, otx, oty;

        function _apply() {
            xform.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
        }

        viewport.addEventListener('wheel', e => {
            e.preventDefault();
            const r = viewport.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            const next = Math.min(Math.max(scale * (e.deltaY < 0 ? 1.1 : 0.9), 0.1), 10);
            tx = mx - (mx - tx) * next / scale;
            ty = my - (my - ty) * next / scale;
            scale = next;
            _apply();
        }, { passive: false });

        viewport.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            drag = true; ox = e.clientX; oy = e.clientY; otx = tx; oty = ty;
            viewport.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            tx = otx + e.clientX - ox; ty = oty + e.clientY - oy;
            _apply();
        });
        document.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = false; viewport.style.cursor = 'grab';
        });
    }

    function _renderLoaded(container, typicalId, meta) {
        const fmt = (meta.format || '').toLowerCase();
        const url = _imgUrl(typicalId);

        let mediaHtml;
        if (fmt === 'dxf') {
            mediaHtml =
                '<div class="mto-img-dxf">' +
                '<span class="mto-img-dxf-icon">📀</span>' +
                '<p>DXF file loaded (not previewable)</p>' +
                `<a class="btn btn-ghost btn-sm" href="${url}" download="${_esc(meta.filename)}">⬇ Download DXF</a>` +
                '</div>';
        } else if (fmt === 'pdf') {
            mediaHtml = `<embed class="mto-img-pdf" src="${url}" type="application/pdf">`;
        } else {
            // SVG — pan/zoom viewport
            mediaHtml =
                '<div class="mto-img-viewport">' +
                `<div class="mto-img-xform"><object class="mto-img-svg" type="image/svg+xml" data="${url}"></object></div>` +
                '</div>';
        }

        container.innerHTML =
            '<div class="mto-img-toolbar">' +
            `<span class="mto-img-fname">${_esc(meta.filename)}</span>` +
            '<label class="btn btn-ghost btn-sm mto-img-replace">↑ Replace' +
            '<input type="file" accept=".svg,.dxf,.pdf" style="display:none" class="mto-img-file"></label>' +
            '<button class="mto-img-del btn btn-ghost btn-sm">✕ Remove</button>' +
            '</div>' +
            '<div class="mto-img-body">' + mediaHtml + '</div>';

        _bindUpload(container.querySelector('.mto-img-file'), typicalId, container);

        container.querySelector('.mto-img-del').addEventListener('click', async () => {
            if (!confirm('Remove this image?')) return;
            const res = await fetch(`/api/engines/mto/${_toolId}/images/${typicalId}?${_param()}`, { method: 'DELETE' });
            if (!res.ok) {
                if (typeof Utils !== 'undefined') Utils.showToast('Remove failed', 'error');
                return;
            }
            await load(_toolId, typicalId, _db, container);
        });

        if (fmt === 'svg') {
            const vp = container.querySelector('.mto-img-viewport');
            _initPanZoom(vp, container.querySelector('.mto-img-xform'));
            MtoAnnotation.init(vp, typicalId);
            MtoAnnotation.onPlace(p => _savePlacement(typicalId, p));
            _loadPlacements(typicalId);
        }
    }

    async function _loadPlacements(typicalId) {
        try {
            const res = await fetch(`/api/engines/mto/${_toolId}/placements/${typicalId}?${_param()}`);
            if (!res.ok) return;
            const data = await res.json();
            MtoAnnotation.setPlacements(data);
        } catch (err) {
            console.error('[MtoImage] placements load error:', err);
        }
    }

    async function _savePlacement(typicalId, p) {
        try {
            await fetch(`/api/engines/mto/${_toolId}/placements/${typicalId}?${_param()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag: p.tag, label_x: p.lx, label_y: p.ly, arrow_x: p.ax, arrow_y: p.ay }),
            });
        } catch (err) {
            console.error('[MtoImage] placement save error:', err);
        }
    }

    async function load(toolId, typicalId, db, container) {
        _toolId = toolId; _db = db;
        container.innerHTML = '<p class="mto-img-loading">Loading…</p>';
        try {
            const meta = await _meta(typicalId);
            if (!meta.exists) _renderEmpty(container, typicalId);
            else _renderLoaded(container, typicalId, meta);
        } catch (err) {
            container.innerHTML = '<p class="mto-img-error">Failed to load image.</p>';
            console.error('[MtoImage] load error:', err);
        }
    }

    return { load };
})();
