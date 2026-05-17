const ClipboardManager = (() => {

    let _getRanges      = null;
    let _isEditing      = null;
    let _getColumns     = null;
    let _getFilteredRows = null;

    function configure({ getRanges, isEditing, getColumns, getFilteredRows }) {
        _getRanges       = getRanges;
        _isEditing       = isEditing;
        _getColumns      = getColumns;
        _getFilteredRows = getFilteredRows;
    }

    function init() {
        document.addEventListener("keydown", async e => {
            if (!(e.key === "c" && (e.ctrlKey || e.metaKey))) return;
            const ranges = _getRanges();
            if (ranges.length === 0) return;
            if (_isEditing()) return;

            e.preventDefault();

            const columns      = _getColumns();
            const filteredRows = _getFilteredRows();

            let rMin = Infinity, rMax = -Infinity;
            let cMin = Infinity, cMax = -Infinity;
            for (const range of ranges) {
                rMin = Math.min(rMin, range.start.r, range.end.r);
                rMax = Math.max(rMax, range.start.r, range.end.r);
                cMin = Math.min(cMin, range.start.c, range.end.c);
                cMax = Math.max(cMax, range.start.c, range.end.c);
            }

            const lines = [];
            for (let r = rMin; r <= rMax; r++) {
                const row = filteredRows[r];
                if (!row) continue;
                const cells = [];
                for (let c = cMin; c <= cMax; c++) {
                    const inRange = ranges.some(range => {
                        const r0 = Math.min(range.start.r, range.end.r);
                        const r1 = Math.max(range.start.r, range.end.r);
                        const c0 = Math.min(range.start.c, range.end.c);
                        const c1 = Math.max(range.start.c, range.end.c);
                        return r >= r0 && r <= r1 && c >= c0 && c <= c1;
                    });
                    const col = columns[c];
                    cells.push(inRange && col ? String(row[col.slug] ?? "") : "");
                }
                lines.push(cells.join("\t"));
            }

            try {
                await navigator.clipboard.writeText(lines.join("\n"));
                const count = (rMax - rMin + 1) * (cMax - cMin + 1);
                Utils.showToast(`${count} cell${count === 1 ? "" : "s"} copied.`, "success");
            } catch {
                Utils.showToast("Cannot access clipboard.", "error");
            }
        });
    }

    async function triggerCopy() {
        const ranges = _getRanges();
        if (!ranges.length || _isEditing()) return;
        const columns      = _getColumns();
        const filteredRows = _getFilteredRows();
        let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
        for (const range of ranges) {
            rMin = Math.min(rMin, range.start.r, range.end.r);
            rMax = Math.max(rMax, range.start.r, range.end.r);
            cMin = Math.min(cMin, range.start.c, range.end.c);
            cMax = Math.max(cMax, range.start.c, range.end.c);
        }
        const lines = [];
        for (let r = rMin; r <= rMax; r++) {
            const row = filteredRows[r];
            if (!row) continue;
            const cells = [];
            for (let c = cMin; c <= cMax; c++) {
                const inRange = ranges.some(range => {
                    const r0 = Math.min(range.start.r, range.end.r), r1 = Math.max(range.start.r, range.end.r);
                    const c0 = Math.min(range.start.c, range.end.c), c1 = Math.max(range.start.c, range.end.c);
                    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
                });
                const col = columns[c];
                cells.push(inRange && col ? String(row[col.slug] ?? "") : "");
            }
            lines.push(cells.join("\t"));
        }
        try {
            await navigator.clipboard.writeText(lines.join("\n"));
            const count = (rMax - rMin + 1) * (cMax - cMin + 1);
            Utils.showToast(`${count} cell${count === 1 ? "" : "s"} copied.`, "success");
        } catch {
            Utils.showToast("Cannot access clipboard.", "error");
        }
    }

    return { configure, init, triggerCopy };

})();
