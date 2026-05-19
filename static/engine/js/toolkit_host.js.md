---
name: toolkit_host.js companion
description: Companion for the shared ToolkitHost IIFE — engine config wiring, event bus, four-bucket state store, toolkit lifecycle
type: reference
---

# static/engine/js/toolkit_host.js

**Description:** Frontend orchestrator that reads `engine.json` toolkit declarations, fetches per-instance DB config, merges both, and calls each toolkit's `init(ctx)` in declaration order. Provides a shared event bus and a four-bucket state store for cross-toolkit communication.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_state` | ~10 | Four-bucket state object: `engine`, `toolkits`, `filters`, `ui` |
| `_bus` | ~11 | Event bus: `{ [event]: Set<handler> }` |
| `_toolkits` | ~12 | Registered toolkit instances after `init()` |
| `emit(event, payload)` | ~22 | Broadcast event to all registered handlers for that event |
| `on(event, handler)` | ~30 | Subscribe a handler to an event |
| `off(event, handler)` | ~35 | Unsubscribe a handler |
| `getState(bucket, key)` | ~39 | Read from any of the four state buckets |
| `setState(bucket, key, val)` | ~43 | Write to a bucket and emit `state:{bucket}:{key}` event |
| `getToolkit(id)` | ~52 | Return a registered toolkit instance by id |
| `init(engineConfig)` | ~57 | Async — fetches DB config, merges, calls toolkit `init(ctx)` in order |
| `_toPascalCase(id)` | ~99 | Converts `kebab-case` toolkit id → `PascalCase` global name for window lookup |

## Decisions

- **Init is called explicitly**: the IIFE defines `ToolkitHost` but does not auto-execute. Templates must call `ToolkitHost.init(window.__ENGINE_CONFIG__)` explicitly at end of DOMContentLoaded (D-TK-CORE-05, D-TK-CORE-06).
- **Toolkit global resolution**: toolkit id `"my-toolkit"` maps to `window.MyToolkit`. Convention enforced by `_toPascalCase`. No dynamic script loading — all toolkit `<script>` tags are emitted by Jinja2 (D-TK-CORE-04).
- **Four buckets**: `engine` (frozen, set from `__ENGINE_CONFIG__`), `toolkits` (per-toolkit owned state), `filters` (cross-toolkit signals), `ui` (transient interface state). Defined in D-TK-CORE-09.
- **Cross-toolkit communication**: only via `host.emit`/`host.on`. DOM CustomEvents are reserved for toolkit-internal behavior (D-TK-CORE-10).
- **State change events**: `setState(bucket, key, val)` auto-emits `state:{bucket}:{key}` with `{ prev, val, bucket, key }`. Toolkits can react to each other's state changes by subscribing.
- **`host:ready` event**: emitted after all toolkits have been initialized. Payload: `{ config }`.
- **Graceful missing toolkits**: if a declared toolkit's global is not found or has no `init()`, a console warning is issued and that toolkit is skipped — the page still loads.
- **DB config fetch failure**: non-fatal. A console warning is issued and toolkits receive only the static defaults from `engine.json` declarations.
