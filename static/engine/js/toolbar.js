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

        // Aggiorna nome e icona nella sidebar sinistra
        const nameEl = document.getElementById(`sidebar-name-${_tool.slug}`);
        const iconEl = document.getElementById(`sidebar-icon-${_tool.slug}`);
        if (nameEl) nameEl.textContent = _tool.name;
        if (iconEl) iconEl.textContent = _tool.icon || _getDefaultIcon(_tool.slug);

        // Evidenzia tool attivo nella sidebar
        document.querySelectorAll(".sidebar-item[data-tool]").forEach(el => {
            el.classList.toggle("active", el.dataset.tool === _tool.slug);
        });
    }

    function _getDefaultIcon(slug) {
    const icons = {
        "instrument-list": "📋",
        "io-list":         "🔌",
        "cable-list":      "🔧"
    };
    return icons[slug] || "📄";
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

    function switchTab(tabName) {
        // Aggiorna pulsanti tab
        document.querySelectorAll(".settings-tab").forEach(btn => {
            btn.classList.toggle(
                "active",
                btn.textContent.trim().toLowerCase().includes(tabName)
            );
        });

        // Mostra/nasconde contenuto tab
        document.getElementById("tab-generale").style.display =
            tabName === "generale" ? "flex" : "none";
        document.getElementById("tab-etl").style.display =
            tabName === "etl" ? "flex" : "none";

        // Carica schema la prima volta che si apre il tab ETL
        if (tabName === "etl" && !EtlEditor._schemaLoaded) {
            setTimeout(() => EtlEditor.refreshSchema(), 100);
        }
    }

    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        changeRev,
        openSettings,
        saveSettings,
        saveNote,
        addColumn,
        exportExcel,
        selectIcon,
        switchTab
    };

})();