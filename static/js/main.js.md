---
# static/js/main.js

**Description:** Project management, navigation, and modal orchestration for the dashboard page. Handles project CRUD, sidebar state, the "+new Engine" modal flow, and filesystem browsing.

**Index:**
- 1–27: `_getRecents`, `_saveRecents`, `_addRecent`, `_removeRecent` — localStorage recent-project list
- 39–60: DOMContentLoaded — sidebar state restore, URL ?db= auto-open
- 65–73: `toggleSidebar`
- 78–97: `openModal`, `closeModal`, overlay-click and Escape-key dismissal
- 102–165: `_renderWelcomeRecents`, `selectRecentProject`, `removeFromRecents`, `deleteProjectFile`
- 170–243: `_openProjectFromPath`, `_finalizeProjectOpen`, `_showEngineMissingModal`, `_showEngineMismatchModal`, `_cancelMismatchModal`, `_confirmMismatchModal` — project open + guard modals
- 248–288: `newProject`, `_validateNewProject`, `submitNewProject`
- 293–330: `openProject`, `_renderOpenProjectList`, `selectProjectFromModal`
- 335–397: `setActiveProject`, `clearActiveProject`, `_applyProjectToUI`, `_renderSidebarTools`
- 402–405: `openToolById`
- 408–582: New Engine modal — `newEngine`, `_loadEngineCatalog`, `selectEngineType`, `_loadTemplatesInModal`, `selectTemplate`, `importEtlFromFile`, `deleteTemplateFromModal`, `submitNewEngine`
- 587–704: `FsBrowser` IIFE — filesystem browser modal
- 709–746: Backup helpers — `_runOnOpenBackup`, `_startBackupTimer`, `_doBackup`
- 751–763: `escapeHtml`, `escapeAttr`

**Decisions:**
- `_catalogEntriesBySlug` map is populated on each modal open so the data is always fresh and avoids passing large objects through inline `onclick` strings.
- "Load from file" button visibility is driven by `entry.supports_template` from the manifest. Currently false for sheet_v1 so the button is hidden; enabling it only requires setting the manifest field.
- `engine_version` is passed in the create payload so the DB correctly tracks which manifest version each instance was created against (used by the R3 installation guard).
- Route ordering: `/api/engines/catalog` must be declared before `/{tool_id}` in routes.py to avoid the parameterized route capturing it. See `feedback_routing.md`.
