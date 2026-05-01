const SidebarManager = (() => {

    let _isOpen = false;

    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    function toggle() {
        _isOpen ? close() : open();
    }

    function open(title = 'Sidebar') {
        _isOpen = true;
        const panel = document.getElementById('sidebar-panel');
        if (panel) panel.classList.remove('sidebar-closed');
        const titleEl = document.getElementById('sidebar-title');
        if (titleEl) titleEl.textContent = title;
        const btn = document.getElementById('btn-toggle-sidebar');
        if (btn) btn.classList.add('active');
    }

    function close() {
        _isOpen = false;
        const panel = document.getElementById('sidebar-panel');
        if (panel) panel.classList.add('sidebar-closed');
        const btn = document.getElementById('btn-toggle-sidebar');
        if (btn) btn.classList.remove('active');
    }

    function isOpen() {
        return _isOpen;
    }

    // --------------------------------------------------------
    // SECTION MANAGEMENT (for future LOG, FLAGS, etc.)
    // --------------------------------------------------------

    function setTitle(title) {
        const titleEl = document.getElementById('sidebar-title');
        if (titleEl) titleEl.textContent = title;
    }

    function setContent(html) {
        const body = document.getElementById('sidebar-body');
        if (body) body.innerHTML = html;
    }

    function clearContent() {
        setContent('<p class="sidebar-empty">Nessun contenuto.</p>');
    }

    return { toggle, open, close, isOpen, setTitle, setContent, clearContent };
})();
