// apps/web/src/components/NgGeoPicker.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getNgGeo, getNgLgas } from "../lib/api";

const CACHE_KEY = "ngGeoCache_v2";       // bump if schema changes
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// in-memory cache for the session
const memoryCache = {
  states: null,     // array
  lgas: null,       // { [STATE]: [LGAs] }
  loadedAt: 0,
};

export default function NgGeoPicker({
  valueState,
  onChangeState,
  valueLga,
  onChangeLga,
  showAccordion = false,
  disabled = false,
  required = false,
  className = "",
  labelState = "State",
  labelLga = "LGA",
}) {
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState([]);
  const [lgasByState, setLgasByState] = useState({});
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  // ---- load from cache or API ----
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        setError("");
        setLoading(true);

        // 1) memory cache
        const memFresh =
          memoryCache.states &&
          Date.now() - (memoryCache.loadedAt || 0) < CACHE_TTL_MS;

        if (memFresh) {
          if (!mountedRef.current) return;
          setStates(memoryCache.states || []);
          setLgasByState(memoryCache.lgas || {});
          setLoading(false);
          return;
        }

        // 2) localStorage cache
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            if (c?.states?.length && Date.now() - (c.loadedAt || 0) < CACHE_TTL_MS) {
              if (!mountedRef.current) return;
              setStates(c.states || []);
              setLgasByState(c.lgas || {});
              // hydrate memory
              memoryCache.states = c.states || [];
              memoryCache.lgas = c.lgas || {};
              memoryCache.loadedAt = c.loadedAt || Date.now();
              setLoading(false);
              return;
            }
          }
        } catch {}

        // 3) fetch fresh
        const geo = await getNgGeo().catch(() => null);
        if (!geo || !Array.isArray(geo.states)) {
          throw new Error("bad_response");
        }

        const nextStates = geo.states || [];
        const nextLgas = geo.lgas && typeof geo.lgas === "object" ? geo.lgas : {};

        if (!mountedRef.current) return;
        setStates(nextStates);
        setLgasByState(nextLgas);

        // cache
        const snapshot = {
          states: nextStates,
          lgas: nextLgas,
          loadedAt: Date.now(),
        };
        memoryCache.states = snapshot.states;
        memoryCache.lgas = snapshot.lgas;
        memoryCache.loadedAt = snapshot.loadedAt;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
        } catch {}

      } catch {
        if (!mountedRef.current) return;
        setError("Could not load Nigeria States & LGAs.");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    return () => { mountedRef.current = false; };
  }, []);

  // ---- if a state is selected but we don't have its LGAs yet, lazy-load them ----
  useEffect(() => {
    (async () => {
      const st = valueState?.trim();
      if (!st) return;

      // already have LGAs for this state?
      if (Array.isArray(lgasByState[st]) && lgasByState[st].length) return;

      try {
        const list = await getNgLgas(st); // returns array
        if (!mountedRef.current) return;

        const updated = { ...lgasByState, [st]: Array.isArray(list) ? list : [] };
        setLgasByState(updated);

        // update caches
        memoryCache.lgas = updated;
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          const c = raw ? JSON.parse(raw) : { states, lgas: {}, loadedAt: Date.now() };
          c.lgas = updated;
          localStorage.setItem(CACHE_KEY, JSON.stringify(c));
        } catch {}
      } catch {
        // ignore; UI will still show "Select LGA…" with empty list
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueState]);

  // keep LGA coherent when state changes
  useEffect(() => {
    if (!valueState && valueLga) onChangeLga?.("");
    // if state changed and current LGA not in list, clear it
    const list = valueState ? (lgasByState[valueState] || []) : [];
    if (valueLga && !list.includes(valueLga)) onChangeLga?.("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueState, lgasByState]);

  const lgaOptions = useMemo(
    () => (valueState ? (lgasByState[valueState] || []) : []),
    [valueState, lgasByState]
  );

  return (
    <div className={className}>
      {error && (
        <div className="mb-2 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {error}
        </div>
      )}

      {showAccordion ? (
        <AccordionView
          loading={loading}
          states={states}
          lgasByState={lgasByState}
          valueState={valueState}
          onChangeState={(st) => {
            if (st !== valueState) onChangeLga?.("");
            onChangeState?.(st);
          }}
          valueLga={valueLga}
          onChangeLga={onChangeLga}
          disabled={disabled}
        />
      ) : (
        <DropdownView
          loading={loading}
          states={states}
          lgas={lgaOptions}
          valueState={valueState}
          onChangeState={(st) => {
            if (st !== valueState) onChangeLga?.("");
            onChangeState?.(st);
          }}
          valueLga={valueLga}
          onChangeLga={onChangeLga}
          disabled={disabled}
          required={required}
          labelState={labelState}
          labelLga={labelLga}
        />
      )}
    </div>
  );
}

/* ---------------------- Views ---------------------- */

function DropdownView({
  loading,
  states,
  lgas,
  valueState,
  onChangeState,
  valueLga,
  onChangeLga,
  disabled,
  required,
  labelState,
  labelLga,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label className="block">
        <div className="text-xs text-zinc-400">
          {labelState}
          {required ? " *" : ""}
        </div>
        <select
          className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={valueState}
          onChange={(e) => onChangeState?.(e.target.value)}
          disabled={disabled || loading}
          required={required}
        >
          <option value="">{loading ? "Loading…" : "Select state…"}</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="text-xs text-zinc-400">
          {labelLga}
          {required ? " *" : ""}
        </div>
        <select
          className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={valueLga}
          onChange={(e) => onChangeLga?.(e.target.value)}
          disabled={disabled || loading || !valueState}
          required={required}
        >
          <option value="">
            {!valueState
              ? "Select a state first…"
              : loading
              ? "Loading…"
              : "Select LGA…"}
          </option>
          {lgas.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AccordionView({
  loading,
  states,
  lgasByState,
  valueState,
  onChangeState,
  valueLga,
  onChangeLga,
  disabled,
}) {
  if (loading) return <div>Loading…</div>;
  return (
    <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
      {states.map((st) => {
        const open = st === valueState;
        const lgas = lgasByState[st] || [];
        return (
          <div key={st}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChangeState?.(open ? "" : st)}
              className="w-full text-left px-4 py-2 hover:bg-zinc-900/50 disabled:opacity-50"
            >
              <span className="font-medium">{st}</span>
              <span className="text-xs text-zinc-500"> ({lgas.length} LGAs)</span>
            </button>

            {open && (
              <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {lgas.map((l) => {
                  const active = l === valueLga;
                  return (
                    <button
                      type="button"
                      disabled={disabled}
                      key={l}
                      onClick={() => onChangeLga?.(l)}
                      className={`text-left text-sm px-2 py-1 rounded border ${
                        active
                          ? "border-gold text-gold"
                          : "border-zinc-800 hover:bg-zinc-900/50"
                      }`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
