/**
 * toolkit_host.js
 * ---------------
 * Host IIFE: wires toolkit declarations from engine.json + DB config,
 * calls init(ctx) on each toolkit in declaration order, provides
 * a shared event bus and four-bucket state store.
 *
 * See toolkit_host.js.md and ENGINE_AUTHORING.md for authoring guide.
 */
const ToolkitHost = (() => {
    // Four-bucket state: engine (immutable), toolkits, filters, ui
    const _state = {
        engine: {},
        toolkits: {},
        filters: {},
        ui: {},
    };

    // Event bus: { [event]: Set<handler> }
    const _bus = {};

    // Registered toolkit instances: { [id]: object returned by toolkit init }
    const _toolkits = {};

    // Read-only merged config (set on init)
    let _config = null;
    let _engineCtx = null;

    function emit(event, payload) {
        const handlers = _bus[event];
        if (!handlers) return;
        for (const h of handlers) {
            try { h(payload); } catch (e) { console.error("[ToolkitHost] handler error", event, e); }
        }
    }

    function on(event, handler) {
        if (!_bus[event]) _bus[event] = new Set();
        _bus[event].add(handler);
    }

    function off(event, handler) {
        _bus[event]?.delete(handler);
    }

    function getState(bucket, key) {
        return key !== undefined ? _state[bucket]?.[key] : _state[bucket];
    }

    function setState(bucket, key, val) {
        if (!_state[bucket]) _state[bucket] = {};
        const prev = _state[bucket][key];
        _state[bucket][key] = val;
        emit(`state:${bucket}:${key}`, { prev, val, bucket, key });
    }

    function getToolkit(id) {
        return _toolkits[id] ?? null;
    }

    /**
     * init(engineConfig) — called once at page load with window.__ENGINE_CONFIG__.
     *
     * 1. Fetches _toolkit_config rows from the backend.
     * 2. Merges DB config on top of static defaults from engine.json.
     * 3. Calls toolkit.init(ctx) in declaration order.
     */
    async function init(engineConfig) {
        if (_config) { console.warn("[ToolkitHost] already initialized"); return; }

        const { slug, toolInstanceId, dbPath, endpointBase, toolkits: declarations } = engineConfig;

        _engineCtx = { slug, toolInstanceId, dbPath, endpointBase };
        Object.freeze(_engineCtx);

        // Freeze engine bucket
        _state.engine = Object.freeze({ slug, toolInstanceId, dbPath, endpointBase });

        // Fetch per-instance DB config
        let dbConfig = {};
        try {
            const url = `${endpointBase}/api/engines/${slug}/tools/${toolInstanceId}/toolkit-config?db=${encodeURIComponent(dbPath)}`;
            const res = await fetch(url);
            if (res.ok) dbConfig = await res.json();
        } catch (e) {
            console.warn("[ToolkitHost] could not load toolkit-config from DB", e);
        }

        // Build merged config: static defaults from declaration, overridden by DB config
        const merged = {};
        for (const decl of (declarations ?? [])) {
            merged[decl.id] = Object.assign({}, decl.defaults ?? {}, dbConfig[decl.id] ?? {});
        }
        _config = Object.freeze(merged);

        // Build shared context object passed to every toolkit
        const ctx = Object.freeze({
            engine: _state.engine,
            config: _config,
            emit,
            on,
            off,
            getState,
            setState,
            getToolkit,
        });

        // Call init on each declared toolkit in order
        for (const decl of (declarations ?? [])) {
            const tk = window[_toPascalCase(decl.id)];
            if (!tk || typeof tk.init !== "function") {
                console.warn("[ToolkitHost] toolkit not found or missing init():", decl.id);
                continue;
            }
            try {
                const instance = tk.init(ctx);
                _toolkits[decl.id] = instance ?? {};
            } catch (e) {
                console.error("[ToolkitHost] init() failed for toolkit:", decl.id, e);
            }
        }

        emit("host:ready", { config: _config });
    }

    function _toPascalCase(id) {
        return id.replace(/(^|[-_])([a-z])/g, (_, __, c) => c.toUpperCase());
    }

    return {
        init,
        emit,
        on,
        off,
        getState,
        setState,
        getToolkit,
        get config() { return _config; },
        get engine() { return _engineCtx; },
    };
})();
