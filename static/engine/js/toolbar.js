/**
 * toolbar.js — Engine
 * --------------------
 * Gestisce le azioni della toolbar del tool.
 *
 * Responsabilità:
 * - Init: carica nome tool e revisione attiva
 * - Cambio revisione
 * - Apertura/salvataggio settings tool
 * - Salvataggio nota
 * - Export Excel
 * - Apertura modal aggiungi colonna
 */

// Lista icone disponibili
const TOOL_ICONS = [
    "📋","📊","📈","📉","📌","📍","📎","🔧","🔩","⚙",
    "🔌","💡","🔋","🖥","💾","📡","🏭","🧪","⚗","🔬",
    "📐","📏","🗂","🗃","📁","📂","🗄","📄","📝","✏",
    "🔑","🔒","🛡","⚠","🚧","🏗","🔴","🟡","🟢","🔵"
];

const ToolbarManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _tool = null;  // Dati tool corrente


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    async function init() {
        try {
            _tool = await ApiClient.loadTool();
            _updateToolUI();

            const noteEl = document.getElementById("tool-note");
            if (noteEl) noteEl.value = _tool.note || "";

        } catch (err) {
            showToast("Errore caricamento tool: " + err.message, "error");
        }
    }

    // --------------------------------------------------------
    // AGGIORNAMENTO UI
    // --------------------------------------------------------

    function _updateToolUI() {
        // Aggiorna badge REV nella topbar
        const revBadge = document.getElementById("rev-badge");
        if (revBadge) revBadge.textContent = `REV ${_tool.current_rev}`;

        // Aggiorna titolo pagina
        document.title = `${_tool.name} — Instrument Manager`;

        // Aggiorna nome e icona nell'item attivo della sidebar dinamica
        const activeItem = document.querySelector(`.sidebar-item[data-tool-id="${TOOL_ID}"]`);
        if (activeItem) {
            const iconEl = activeItem.querySelector(".sidebar-icon");
            const nameEl = activeItem.querySelector("span:not(.sidebar-icon)");
            if (iconEl) iconEl.textContent = _tool.icon || "📄";
            if (nameEl) nameEl.textContent = _tool.name;
        }
    }

    // --------------------------------------------------------
    // CAMBIO REVISIONE
    // --------------------------------------------------------

    async function changeRev() {
        const current = _tool?.current_rev || "A";
        const newRev  = prompt(
            `Revisione attuale: ${current}\nInserisci la nuova revisione:`,
            current
        );

        if (newRev === null) return;

        const trimmed = newRev.trim().toUpperCase();
        if (!trimmed) {
            showToast("La revisione non può essere vuota.", "error");
            return;
        }

        try {
            _tool = await ApiClient.updateToolSettings({ current_rev: trimmed });
            _updateToolUI();
            showToast(`Revisione aggiornata a ${trimmed}.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    function _renderIconPicker(currentIcon) {
        const picker = document.getElementById("icon-picker");
        if (!picker) return;

        picker.innerHTML = TOOL_ICONS.map(icon => `
            <div
                class="icon-option ${icon === currentIcon ? "selected" : ""}"
                onclick="ToolbarManager.selectIcon('${icon}')"
                title="${icon}"
            >${icon}</div>
        `).join("");
    }

    function selectIcon(icon) {
        document.getElementById("settings-icon").value = icon;
        document.querySelectorAll(".icon-option").forEach(el => {
            el.classList.toggle("selected", el.textContent === icon);
        });
    }

    // --------------------------------------------------------
    // SETTINGS TOOL
    // --------------------------------------------------------

    function openSettings() {
        if (!_tool) return;
        document.getElementById("settings-name").value = _tool.name || "";
        document.getElementById("settings-rev").value  = _tool.current_rev || "A";
        document.getElementById("settings-icon").value = _tool.icon || "📄";
        _renderIconPicker(_tool.icon || "📄");
        openModal("modal-settings");
    }

    async function saveSettings() {
        const name = document.getElementById("settings-name").value.trim();
        const rev  = document.getElementById("settings-rev").value.trim().toUpperCase();
        const icon = document.getElementById("settings-icon").value || "📄";

        if (!name) {
            showToast("Il nome del tool non può essere vuoto.", "error");
            return;
        }

        try {
            _tool = await ApiClient.updateToolSettings({ name, current_rev: rev, icon });
            _updateToolUI();
            closeModal("modal-settings");
            showToast("Impostazioni salvate.", "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    // --------------------------------------------------------
    // NOTA
    // --------------------------------------------------------

    async function saveNote(content) {
        try {
            await ApiClient.updateToolSettings({ note: content });
        } catch (err) {
            showToast("Errore salvataggio nota: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // AGGIUNGI COLONNA
    // --------------------------------------------------------

    function addColumn() {
        ColumnsManager.openAddColumnModal();
    }


    // --------------------------------------------------------
    // EXPORT
    // --------------------------------------------------------

    function exportExcel() {
        showToast("Export Excel — disponibile nella prossima fase.", "info");
    }

    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    function getToolType() {
        return _tool?.tool_type || null;
    }

    return {
        init,
        changeRev,
        openSettings,
        saveSettings,
        saveNote,
        addColumn,
        exportExcel,
        selectIcon,
        getToolType
    };

})();