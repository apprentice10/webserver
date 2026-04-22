/**
 * main.js
 * --------
 * Modulo principale dell'applicazione.
 * Gestisce stato globale progetto, modal, navigazione.
 */

// ============================================================
// STATO GLOBALE — persiste in sessionStorage
// ============================================================

const App = {

    get currentProject() {
        const stored = sessionStorage.getItem("currentProject");
        return stored ? JSON.parse(stored) : null;
    },

    set currentProject(project) {
        if (project) {
            sessionStorage.setItem("currentProject", JSON.stringify(project));
        } else {
            sessionStorage.removeItem("currentProject");
        }
    }
};


// ============================================================
// INIT — ripristina stato al caricamento pagina
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    const project = App.currentProject;
    if (project) {
        _applyProjectToUI(project);
    }

    // Ripristina stato sidebar
    if (localStorage.getItem("sidebarCollapsed") === "1") {
        const sidebar = document.getElementById("main-sidebar");
        const btn     = document.getElementById("sidebar-toggle");
        if (sidebar) sidebar.classList.add("collapsed");
        if (btn)     btn.textContent = "›";
    }
});


// ============================================================
// SIDEBAR COLLAPSIBLE
// ============================================================

function toggleSidebar() {
    const sidebar   = document.getElementById("main-sidebar");
    const btn       = document.getElementById("sidebar-toggle");
    const collapsed = sidebar.classList.toggle("collapsed");
    btn.textContent = collapsed ? "›" : "‹";
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
}


// ============================================================
// MODAL
// ============================================================

function openModal(id) {
    document.getElementById(id).classList.add("active");
}

function closeModal(id) {
    document.getElementById(id).classList.remove("active");
}

document.addEventListener("click", function (e) {
    if (e.target.classList.contains("modal-overlay")) {
        e.target.classList.remove("active");
    }
});

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        document.querySelectorAll(".modal-overlay.active")
            .forEach(m => m.classList.remove("active"));
    }
});


// ============================================================
// NUOVO PROGETTO
// ============================================================

function newProject() {
    document.getElementById("input-project-name").value = "";
    document.getElementById("input-project-client").value = "";
    document.getElementById("input-project-description").value = "";
    openModal("modal-new-project");
}

async function submitNewProject() {
    const name        = document.getElementById("input-project-name").value.trim();
    const client      = document.getElementById("input-project-client").value.trim();
    const description = document.getElementById("input-project-description").value.trim();

    if (!name) {
        alert("Il nome del progetto è obbligatorio.");
        return;
    }

    try {
        const response = await fetch("/api/projects/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, client, description })
        });

        if (!response.ok) throw new Error("Errore nella creazione del progetto");

        const project = await response.json();
        closeModal("modal-new-project");
        setActiveProject(project);

    } catch (err) {
        alert("Errore: " + err.message);
    }
}


// ============================================================
// APRI PROGETTO
// ============================================================

async function openProject() {
    openModal("modal-open-project");
    await loadProjectsList();
}

async function loadProjectsList() {
    const container = document.getElementById("projects-list");
    container.innerHTML = "<p class='text-muted'>Caricamento...</p>";

    try {
        const response = await fetch("/api/projects/");
        if (!response.ok) throw new Error("Errore nel caricamento");

        const projects = await response.json();

        if (projects.length === 0) {
            container.innerHTML = "<p class='text-muted'>Nessun progetto trovato. Creane uno nuovo.</p>";
            return;
        }

        container.innerHTML = projects.map(p => `
            <div class="project-list-item" onclick="selectProject(${p.id})">
                <div class="project-list-info">
                    <span class="project-list-name">${escapeHtml(p.name)}</span>
                    <span class="project-list-client">
                        ${p.client ? escapeHtml(p.client) : "Nessun cliente"}
                    </span>
                </div>
                <div class="project-list-actions">
                    <button
                        class="btn-icon"
                        title="Elimina"
                        onclick="deleteProject(event, ${p.id})"
                    >🗑</button>
                </div>
            </div>
        `).join("");

    } catch (err) {
        container.innerHTML = "<p class='text-error'>Errore nel caricamento dei progetti.</p>";
    }
}

async function selectProject(id) {
    try {
        const response = await fetch(`/api/projects/${id}`);
        if (!response.ok) throw new Error("Progetto non trovato");

        const project = await response.json();
        closeModal("modal-open-project");
        setActiveProject(project);

    } catch (err) {
        alert("Errore: " + err.message);
    }
}

async function deleteProject(event, id) {
    event.stopPropagation();

    if (!confirm("Eliminare questo progetto? L'operazione è irreversibile.")) return;

    try {
        const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Errore nell'eliminazione");

        if (App.currentProject && App.currentProject.id === id) {
            clearActiveProject();
        }

        await loadProjectsList();

    } catch (err) {
        alert("Errore: " + err.message);
    }
}


// ============================================================
// GESTIONE PROGETTO ATTIVO
// ============================================================

function setActiveProject(project) {
    App.currentProject = project;
    _applyProjectToUI(project);
}

function clearActiveProject() {
    App.currentProject = null;
    document.getElementById("project-name").textContent = "Nessun progetto aperto";
    const nav = document.getElementById("tools-nav");
    if (nav) nav.innerHTML = "";
    const btn = document.getElementById("btn-new-tool");
    if (btn) btn.classList.add("disabled");
}

/**
 * Applica il progetto all'UI: aggiorna nome, abilita pulsanti
 * e popola la sidebar con i tool del progetto.
 */
async function _applyProjectToUI(project) {
    const nameEl = document.getElementById("project-name");
    if (nameEl) nameEl.textContent = project.name;

    const btn = document.getElementById("btn-new-tool");
    if (btn) btn.classList.remove("disabled");

    try {
        const tools = await fetch(`/api/tools/project/${project.id}`).then(r => r.json());
        _renderSidebarTools(tools, project.id);
    } catch (_) {
        // Se il fetch fallisce la sidebar rimane vuota
    }
}

/**
 * Genera dinamicamente i link nella sidebar per ogni tool del progetto.
 * Se TOOL_ID è definito (pagina tool view) marca il tool corrente come attivo.
 */
function _renderSidebarTools(tools, projectId) {
    const nav = document.getElementById("tools-nav");
    if (!nav) return;

    if (tools.length === 0) {
        nav.innerHTML = '<div class="sidebar-empty">Nessun tool — creane uno!</div>';
        return;
    }

    const currentToolId = (typeof TOOL_ID !== "undefined") ? TOOL_ID : null;

    nav.innerHTML = tools.map(tool => `
        <a href="#" class="sidebar-item${tool.id === currentToolId ? " active" : ""}"
           data-tool-id="${tool.id}"
           onclick="openToolById(${tool.id}, ${projectId}); return false;">
            <span class="sidebar-icon">${escapeHtml(tool.icon || "📄")}</span>
            <span>${escapeHtml(tool.name)}</span>
        </a>
    `).join("");
}


// ============================================================
// NAVIGAZIONE TOOL
// ============================================================

function openToolById(toolId, projectId) {
    window.location.href = `/tool/${projectId}/${toolId}`;
}


// ============================================================
// NUOVO TOOL — modal catalogo
// ============================================================

let _selectedCatalogType = null;
let _selectedTemplateId  = null;

async function newTool() {
    const project = App.currentProject;
    if (!project) return;

    _selectedCatalogType = null;
    _selectedTemplateId  = null;

    // Reset modal
    const nameGroup = document.getElementById("tool-name-group");
    if (nameGroup) nameGroup.style.display = "none";
    const templatesGroup = document.getElementById("tool-templates-group");
    if (templatesGroup) templatesGroup.style.display = "none";
    const createBtn = document.getElementById("btn-create-tool");
    if (createBtn) createBtn.disabled = true;
    const nameInput = document.getElementById("input-tool-name");
    if (nameInput) nameInput.value = "";

    openModal("modal-new-tool");
    await _loadToolCatalog();
}

async function _loadToolCatalog() {
    const grid = document.getElementById("catalog-grid");
    if (!grid) return;

    grid.innerHTML = "<p class='text-muted'>Caricamento...</p>";

    try {
        const types = await fetch("/api/tools/types").then(r => r.json());

        if (types.length === 0) {
            grid.innerHTML = "<p class='text-muted'>Nessun tipo di tool disponibile.</p>";
            return;
        }

        grid.innerHTML = types.map(t => `
            <div class="catalog-card" data-type-slug="${escapeHtml(t.type_slug)}"
                 onclick="selectCatalogType('${escapeHtml(t.type_slug)}', '${escapeHtml(t.name)}', '${escapeHtml(t.icon)}')">
                <div class="catalog-card-icon">${escapeHtml(t.icon)}</div>
                <div class="catalog-card-name">${escapeHtml(t.name)}</div>
                <div class="catalog-card-desc">${escapeHtml(t.description)}</div>
            </div>
        `).join("");

    } catch (err) {
        grid.innerHTML = "<p class='text-error'>Errore caricamento catalogo.</p>";
    }
}

function selectCatalogType(typeSlug, typeName, typeIcon) {
    _selectedCatalogType = { typeSlug, typeName, typeIcon };
    _selectedTemplateId  = null;

    // Evidenzia la card selezionata
    document.querySelectorAll(".catalog-card").forEach(el => {
        el.classList.toggle("selected", el.dataset.typeSlug === typeSlug);
    });

    // Mostra il campo nome e pre-compila con il nome del tipo
    const nameGroup = document.getElementById("tool-name-group");
    if (nameGroup) nameGroup.style.display = "flex";

    const nameInput = document.getElementById("input-tool-name");
    if (nameInput && !nameInput.value) {
        nameInput.value = typeName;
    }
    if (nameInput) nameInput.focus();

    const createBtn = document.getElementById("btn-create-tool");
    if (createBtn) createBtn.disabled = false;

    // Carica i template disponibili per questo tipo
    _loadTemplatesInModal(typeSlug);
}

async function _loadTemplatesInModal(typeSlug) {
    const group = document.getElementById("tool-templates-group");
    const list  = document.getElementById("templates-list");
    if (!group || !list) return;

    try {
        const templates = await fetch(
            `/api/tools/templates?type_slug=${encodeURIComponent(typeSlug)}`
        ).then(r => r.json());

        if (templates.length === 0) {
            group.style.display = "none";
            return;
        }

        list.innerHTML = templates.map(t => `
            <div class="template-item" data-template-id="${t.id}"
                 onclick="selectTemplate(${t.id}, this)">
                <span class="template-item-name">${escapeHtml(t.name)}</span>
                <button class="template-item-delete"
                        onclick="deleteTemplateFromModal(event, ${t.id}, '${escapeHtml(typeSlug)}')"
                        title="Elimina template">✕</button>
            </div>
        `).join("");

        group.style.display = "flex";

    } catch (_) {
        group.style.display = "none";
    }
}

function selectTemplate(templateId, el) {
    const alreadySelected = el.classList.contains("selected");

    document.querySelectorAll(".template-item").forEach(i => i.classList.remove("selected"));

    if (alreadySelected) {
        _selectedTemplateId = null;
    } else {
        el.classList.add("selected");
        _selectedTemplateId = templateId;
    }
}

async function deleteTemplateFromModal(event, templateId, typeSlug) {
    event.stopPropagation();
    if (!confirm("Eliminare questo template?")) return;

    try {
        await fetch(`/api/tools/templates/${templateId}`, { method: "DELETE" });
        await _loadTemplatesInModal(typeSlug);
    } catch (err) {
        alert("Errore: " + err.message);
    }
}

async function submitNewTool() {
    if (!_selectedCatalogType) return;

    const project = App.currentProject;
    if (!project) return;

    const nameInput = document.getElementById("input-tool-name");
    const name = nameInput ? nameInput.value.trim() : _selectedCatalogType.typeName;

    if (!name) {
        alert("Il nome del tool è obbligatorio.");
        return;
    }

    const createBtn = document.getElementById("btn-create-tool");
    if (createBtn) createBtn.disabled = true;

    try {
        const payload = {
            name,
            tool_type: _selectedCatalogType.typeSlug,
            icon: _selectedCatalogType.typeIcon
        };
        if (_selectedTemplateId) {
            payload.template_id = _selectedTemplateId;
        }

        const response = await fetch(`/api/tools/project/${project.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Errore creazione tool");
        }

        const tool = await response.json();
        closeModal("modal-new-tool");

        // Naviga direttamente al nuovo tool
        window.location.href = `/tool/${project.id}/${tool.id}`;

    } catch (err) {
        alert("Errore: " + err.message);
        if (createBtn) createBtn.disabled = false;
    }
}


// ============================================================
// UTILITY
// ============================================================

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
