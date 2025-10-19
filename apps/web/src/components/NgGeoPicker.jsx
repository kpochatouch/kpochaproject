// apps/web/src/components/NgGeoPicker.jsx
import { useEffect, useMemo, useState } from "react";

const API =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:8080";

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
  const [data, setData] = useState({ states: [], lgas: {} });
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError("");
        setLoading(true);
        const res = await fetch(`${API}/api/geo/ng`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load NG geo data");
        if (!alive) return;
        setData({ states: json.states || [], lgas: json.lgas || {} });
      } catch (e) {
        if (!alive) return;
        setError("Could not load Nigeria States & LGAs.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const lgaOptions = useMemo(
    () => (valueState ? (data.lgas[valueState] || []) : []),
    [valueState, data.lgas]
  );

  useEffect(() => {
    if (valueLga && !lgaOptions.includes(valueLga)) onChangeLga?.("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueState]);

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
          data={data}
          valueState={valueState}
          onChangeState={onChangeState}
          valueLga={valueLga}
          onChangeLga={onChangeLga}
          disabled={disabled}
        />
      ) : (
        <DropdownView
          loading={loading}
          states={data.states}
          lgas={lgaOptions}
          valueState={valueState}
          onChangeState={onChangeState}
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
        <div className="text-xs text-zinc-400">{labelState}{required ? " *" : ""}</div>
        <select
          className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={valueState}
          onChange={(e) => onChangeState?.(e.target.value)}
          disabled={disabled || loading}
          required={required}
        >
          <option value="">{loading ? "Loading…" : "Select state…"}</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="block">
        <div className="text-xs text-zinc-400">{labelLga}{required ? " *" : ""}</div>
        <select
          className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={valueLga}
          onChange={(e) => onChangeLga?.(e.target.value)}
          disabled={disabled || loading || !valueState}
          required={required}
        >
          <option value="">
            {!valueState ? "Select a state first…" : loading ? "Loading…" : "Select LGA…"}
          </option>
          {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}

function AccordionView({ loading, data, valueState, onChangeState, valueLga, onChangeLga, disabled }) {
  if (loading) return <div>Loading…</div>;
  return (
    <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
      {data.states.map((st) => {
        const open = st === valueState;
        const lgas = data.lgas[st] || [];
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
                        active ? "border-gold text-gold" : "border-zinc-800 hover:bg-zinc-900/50"
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
