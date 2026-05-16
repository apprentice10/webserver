const AutoComplete = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _dropdown     = null;
    let _suggestions  = [];
    let _selectedIdx  = -1;
    let _currentInput = null;
    let _debounce     = null;

    // --------------------------------------------------------
    // DROPDOWN
    // --------------------------------------------------------

    function _ensureDrop() {
        if (_dropdown) return _dropdown;
        _dropdown = document.createElement('div');
        _dropdown.id = 'ac-dropdown';
        _dropdown.className = 'ac-dropdown';
        document.body.appendChild(_dropdown);
        return _dropdown;
    }

    function _reposition() {
        if (!_currentInput || !_dropdown) return;
        const rect = _currentInput.getBoundingClientRect();
        _dropdown.style.left     = rect.left + 'px';
        _dropdown.style.top      = (rect.bottom + 2) + 'px';
        _dropdown.style.minWidth = Math.max(120, rect.width) + 'px';
    }

    function _render() {
        if (!_suggestions.length || !_currentInput) { hide(); return; }
        const dd = _ensureDrop();
        dd.innerHTML = _suggestions.map((s, i) =>
            `<div class="ac-item${i === _selectedIdx ? ' ac-item-active' : ''}" data-idx="${i}">${Utils.escHtml(s)}</div>`
        ).join('');
        _reposition();
        dd.style.display = 'block';

        dd.querySelectorAll('.ac-item').forEach(el => {
            el.addEventListener('mousedown', e => {
                e.preventDefault();
                _accept(_suggestions[+el.dataset.idx]);
            });
        });
    }

    function _accept(value) {
        if (!_currentInput) return;
        _currentInput.value = value;
        hide();
    }

    function hide() {
        if (_dropdown) _dropdown.style.display = 'none';
        _suggestions = []; _selectedIdx = -1; _currentInput = null;
    }

    function isVisible() {
        return !!(_dropdown && _dropdown.style.display !== 'none');
    }

    // --------------------------------------------------------
    // KEYBOARD HANDLER (called by CellKeyboard.onCellKeydown)
    // Returns true if the event was consumed, false otherwise.
    // --------------------------------------------------------

    function onKeydown(e, input) {
        if (!isVisible()) return false;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            _selectedIdx = Math.min(_suggestions.length - 1, _selectedIdx + 1);
            _render();
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            _selectedIdx = Math.max(0, _selectedIdx - 1);
            _render();
            return true;
        }
        if (e.key === 'Alt') {
            if (_selectedIdx >= 0) { e.preventDefault(); _accept(_suggestions[_selectedIdx]); return true; }
        }
        if (e.key === 'Escape') {
            hide();
            return true;
        }
        return false;
    }

    // --------------------------------------------------------
    // FETCH & SHOW
    // --------------------------------------------------------

    async function _fetch(input) {
        const colSlug = input.dataset.field;
        const prefix  = input.value;
        if (!colSlug || !prefix || input.dataset.ghost !== undefined) { hide(); return; }

        const col = ColumnsManager.getColumns().find(c => c.slug === colSlug);
        if (!col || col.is_system || col.slug === 'log' || col.slug === 'rev') { hide(); return; }

        try {
            const values = await ApiClient.getColumnValues(colSlug, prefix);
            if (_currentInput !== input) return; // stale response — input changed
            // Filter out exact match if it's the only suggestion (not useful)
            const filtered = values.filter(v => v.toLowerCase() !== prefix.toLowerCase());
            if (!filtered.length) { hide(); return; }
            _suggestions = filtered;
            _selectedIdx = 0; // auto-highlight first item; Alt accepts it
            _render();
        } catch (_) {
            hide();
        }
    }

    function onInput(input) {
        _currentInput = input;
        _selectedIdx  = -1;
        clearTimeout(_debounce);
        _debounce = setTimeout(() => _fetch(input), 220);
    }

    // --------------------------------------------------------
    // INIT — event delegation on stable #grid-body element
    // --------------------------------------------------------

    function init() {
        const gridBody = document.getElementById('grid-body');
        if (!gridBody) return;

        gridBody.addEventListener('input', e => {
            const input = e.target;
            if (!input.classList.contains('cell-input')) return;
            if (input.hasAttribute('readonly') || input.dataset.ghost !== undefined) return;
            onInput(input);
        });

        document.addEventListener('mousedown', e => {
            if (isVisible() && !e.target.closest('#ac-dropdown') && e.target !== _currentInput) {
                hide();
            }
        });
    }

    return { init, onKeydown, hide, isVisible };

})();
