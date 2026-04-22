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
});


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
    document.querySelectorAll(".sidebar-item[data-tool]")
        .forEach(el => el.classList.add("disabled"));
}

/**
 * Applica il progetto all'UI — chiamato sia al set
 * che al ripristino da sessionStorage al cambio pagina.
 */
function _applyProjectToUI(project) {
    const nameEl = document.getElementById("project-name");
    if (nameEl) nameEl.textContent = project.name;

    document.querySelectorAll(".sidebar-item.disabled")
        .forEach(el => el.classList.remove("disabled"));
}


// ============================================================
// NAVIGAZIONE TOOL
// ============================================================

async function openTool(toolName) {
    const project = App.currentProject;
    if (!project) {
        alert("Apri un progetto prima di accedere ai tool.");
        return;
    }

    const toolDefs = {
        "instrument-list": {
            name: "Instrument List",
            slug: "instrument-list"
        },
        "io-list": {
            name: "I/O List",
            slug: "io-list"
        },
        "cable-list": {
            name: "Cable List",
            slug: "cable-list"
        }
    };

    const toolDef = toolDefs[toolName];
    if (!toolDef) return;

    try {
        // Cerca il tool esistente per questo progetto
        const tools = await fetch(
            `/api/tools/project/${project.id}`
        ).then(r => r.json());

        let tool = tools.find(t => t.slug === toolName);

        // Se non esiste, lo crea con le colonne default
        if (!tool) {
            tool = await _createDefaultTool(project.id, toolDef);
        }

        // Naviga alla pagina del tool
        window.location.href = `/tool/${project.id}/${tool.id}`;

    } catch (err) {
        alert("Errore apertura tool: " + err.message);
    }
}

async function _createDefaultTool(projectId, toolDef) {
    // Importa le colonne default in base allo slug
    const defaultColumns = await _getDefaultColumns(toolDef.slug);

    const response = await fetch(`/api/tools/project/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: toolDef.name,
            slug: toolDef.slug,
            default_columns: defaultColumns
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Errore creazione tool");
    }

    return response.json();
}

async function _getDefaultColumns(slug) {
    // Le colonne vengono definite esclusivamente dall'ETL Editor.
    // Al momento della creazione il tool ha solo TAG, REV e LOG
    // che sono colonne di sistema create automaticamente dal backend.
    return [];
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