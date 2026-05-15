// Adapter: maps legacy SidebarManager calls to PanelSystem.
// grid.js and flags.js call open(title) then setContent(html) — open() activates
// the panel silently (no onActivate) so callers fill content themselves.
const SidebarManager = (() => {
    const _ID_MAP = {
        'History': 'history', 'LOG': 'history', 'LOG ': 'history',
        'Flags': 'flags', 'FLAG MANAGER': 'flags', 'Flag Manager': 'flags',
        'Info': 'info',
    };

    function _idFor(title) {
        return _ID_MAP[title] || 'info';
    }

    function toggle()         { PanelSystem.togglePanel('info'); }
    function open(title = '') { PanelSystem.showPanel(_idFor(title), { silent: true }); }
    function close()          { PanelSystem.closeAll(); }

    function isOpen() {
        const p = document.getElementById('sidebar-panel');
        return p ? !p.classList.contains('sidebar-closed') : false;
    }

    function setTitle(title) {
        const el = document.getElementById('sidebar-title');
        if (el) el.textContent = title;
    }

    function setContent(html) {
        const el = document.getElementById('sidebar-body');
        if (el) el.innerHTML = html;
    }

    function clearContent() {
        setContent('<p class="sidebar-empty">No content.</p>');
    }

    return { toggle, open, close, isOpen, setTitle, setContent, clearContent };
})();
