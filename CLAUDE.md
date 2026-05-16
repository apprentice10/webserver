# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Instrument Manager** — web app for electro-instrumental engineering design of pharmaceutical plants. Each "tool" (Instrument List, Cable List, I/O List…) is an independent technical document sharing the same universal Table Engine.

---

## Running the Server

```bash
venv\Scripts\activate
uvicorn main:app --reload
# Docs: http://127.0.0.1:8000/docs
```

---

## Session Start Protocol

Every session, in this order:

1. Read `_context/infra/MODULE_LAYOUT.md` — full orientation on every module.
2. Read `_context/session/CURRENT_STATE.md` — find the task the user gives you.
3. Read the one linked plan file for that task. Stop. Do not read anything else unless the plan file explicitly references it (one hop only).

Maximum 3 file reads before touching code.

---

## Task Assignment Rule

You tell me which task to work on. I look it up in `session/CURRENT_STATE.md` and read only that plan file.

**Unplanned tasks** (no link in CURRENT_STATE): run `/grill-me` first to produce a plan file. Do not start execution without a plan file.

---

## Write-back Rules

Apply after every completed step:

| Event | Action |
|-------|--------|
| Step completed | Check it off in the plan file |
| Task fully done | Append one bullet to `session/DONE/<category>.md` + remove from `session/CURRENT_STATE.md` + delete plan file |
| Cross-cutting decision made | Append to `infra/DECISIONS.md` |
| New domain term introduced | Append to `infra/GLOSSARY.md` |

Skipping write-back corrupts project memory and forces reconstruction at the start of the next session. No exceptions.

---

## Context Folder Structure

```
_context/
  etl/          ETL staleness, data flows, bidirectional ETL, canvas design
  grid/         System columns, frontend patterns
  project/      Active plan files (one per feature group)
  infra/        DECISIONS.md, GLOSSARY.md, URL_STRUCTURE.md, MODULE_LAYOUT.md
  session/
    CURRENT_STATE.md    Task index (pure index — links only)
    DONE/
      etl.md            Completed ETL features
      grid.md           Completed grid/table features
      project.md        Completed project management features
      infra.md          Completed refactoring / infrastructure tasks
```

**Rules:**
- CLAUDE.md owns behavioral rules only. Domain knowledge goes in `_context/`.
- If a rule only applies to one feature, it lives in that feature's plan file.
- If a decision constrains the whole system, it goes in `infra/DECISIONS.md`.
- Risks live inside each plan file — no standalone RISKS.md.
- Completed plan files: extract cross-cutting decisions → record in `session/DONE/` → delete the plan file.
- No duplication: if information exists in one file, other files link to it.

---

## Plan File Format

Every plan file must have exactly these four sections:

```markdown
## Goal
One paragraph — what this feature does and why.

## Steps
- [ ] Step N — description
(complex steps get a detail sub-section in the same file; I judge complexity)

## Decisions
Locked design decisions from the /grill-me session.

## Risks
What can break. Scoped to this feature only.
```

Update the steps checklist as each step completes.

---

## Language Standard

**English is mandatory** for all source code, comments, documentation, `_context/` files, companion `.md` files, and commit messages.

---

## Companion `.md` Standard

Every source file has a `<name>.<ext>.md` in the same directory. No separate listing needed — the rule is universal.

**Required sections:** Description, Index (line numbers → symbol descriptions), Decisions (non-obvious constraints and pitfalls).

Create the companion `.md` when a new source file is created. Update it when a significant section is added or removed. Record the *why*, not the *what*.

**Forbidden:**
- Describing what the code does without explaining why non-obvious choices were made.
- Duplicating content from `_context/` — link instead.

**Always:**
- Read companion `.md` before the source file.
- Avoid reading the hole source file, pick what you need from the companion `.md` and focus on that.
- Keep the companion `.md` file updated, if you find discrepancy fix the companion `.md`.
---

## Module Size Constraints

Files must remain small and focused — single clear responsibility. If a file accumulates unrelated logic or multiple architectural concerns, split it immediately. Favor many small composable modules over large centralized files. No file over 400 lines.

---

## File Reading Policy

1. Read `infra/MODULE_LAYOUT.md` once per session (session start).
2. For any task: read only the linked plan file. Follow references one hop only.
3. `infra/DECISIONS.md` and `infra/GLOSSARY.md`: read only when the plan file explicitly references them.
4. Stop as soon as sufficient information is found.
5. `memory/` files are low-priority hints. Always prefer `_context/` over `memory/`.
6. If `_context/` files contradict the actual code, trust the code and flag the discrepancy.

---

## Frontend

Vanilla JS — no framework, no build step. All modules are IIFEs under `static/engine/js/`. Feature subsystems live in subdirectories (`history/`, `selection/`, `keyboard/`, etc.).

Module patterns, pitfalls, script load order, and CSS details → `_context/grid/FRONTEND_PATTERNS.md`.
