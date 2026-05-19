# Plan: Shared Toolkit Engine — Reframed Architecture

## Goal

Reframe the engine development approach from a fixed MTO engine into a **Toolkit-Based Engine Runtime**: a generic, configuration-driven host that composes reusable toolkits (Grouping, Grid, Grid+Catalog, Image) into domain-specific engineering tools. MTO is just one possible configuration. No behavior is hardcoded into the engine; everything is driven by toolkit configuration. The old `plan_mto_revision.md` is deleted — this plan supersedes it.

Each toolkit is implemented only after a `/grill-me` session locks its behavior. No code is written speculatively.

---

## Steps

- [x] Step 1 — Create plan file + update CURRENT_STATE.md with this task link
- [x] Step 2 — Phase 1: Toolkit System Core — run `/grill-me`, then write sub-plan
- [x] Step 3 — Phase 2: Grouping Toolkit — run `/grill-me`, then write sub-plan → `_context/project/grouping-toolkit.md`
- [x] Step 4 — Phase 3: Shared Grid Toolkit — integration rules only (no redesign), write sub-plan → `_context/project/shared-grid-toolkit.md`
- [x] Step 5 — Phase 4: Grid + Catalog Toolkit — implemented → `_context/project/catalog-toolkit.md` ✓
- [ ] Step 6 — Phase 5: Image Toolkit — run `/grill-me`, then write sub-plan
- [ ] Step 7 — Phase 6: Cross-Toolkit System — run `/grill-me`, then write sub-plan
- [ ] Step 8 — Phase 7: Import / Export System — run `/grill-me`, then write sub-plan

Each phase produces its own sub-plan file in `_context/project/` before any code is touched.

---

## Decisions

**D-TK-01**: Engine is toolkit-agnostic — it must not assume column semantics, domain objects (Typical, MTO, utility), or specific workflows.

**D-TK-02**: Every toolkit is grill-me'd before implementation. No exceptions, even for "obvious" phases.

**D-TK-03**: Shared Grid Toolkit (`static/engine/js/grid/`) is consumed as-is. No redesign, no fork. Grid+Catalog Toolkit extends it.

**D-TK-04**: Toolkits communicate via shared state: filters (Grouping Toolkit), shared row references, catalog bindings, DOM CustomEvents.

**D-TK-05**: All toolkit behavior is surfaced via right-click → Settings panel. Nothing hardcoded.

**D-TK-06**: Database stores only raw data, catalog, toolkit configs, annotations, relationships, and audit. No business logic.

**D-TK-07**: ETL is a data loader/transformer/provider only. All behavior comes from toolkits, not ETL scripts.

**D-TK-08**: Engine declaration uses existing `engine.json` format (see `engines/mto_v1/engine.json`). Toolkit declarations extend it.

---

## Risks

- **Phase ordering dependency**: Toolkit System Core (Phase 1) defines the communication contract. All later phases depend on it. A wrong contract decision here propagates everywhere — the Phase 1 grill-me must be exhaustive.
- **Grid+Catalog Toolkit (Phase 4)**: Catalog sync + conflict handling is the most complex surface. Bidirectional propagation rules are easy to get wrong. Grill-me must cover all edge cases before a line of code.
- **Existing MTO engine**: `engines/mto_v1/` is a live engine. The reframing must not break it. Phases should be additive until a migration point is explicitly planned.
- **Script load order**: The grid toolkit has strict initialization order (`columns.js → ... → grid.js` last). Any new toolkit wrapping the grid must respect this — see `ENGINE_AUTHORING.md` and `SHARED_GRID_TOOLKIT.md`.

---

## Critical Files

| File | Role |
|------|------|
| `_context/infra/ENGINE_AUTHORING.md` | Engine plugin contract, static mounting, router registration |
| `_context/grid/SHARED_GRID_TOOLKIT.md` | Grid toolkit wiring, feature levels, DOM requirements, event bus |
| `_context/infra/DECISIONS.md` | Locked system-wide decisions (D01–D19, D-S1–S8) |
| `engines/mto_v1/engine.json` | Reference `engine.json` format |
| `static/engine/js/grid/` | Grid toolkit source (consumed, not modified in early phases) |
| `_context/session/CURRENT_STATE.md` | Task index — update after this plan is approved |
