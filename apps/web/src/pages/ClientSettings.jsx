// apps/web/src/pages/ClientSettings.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export default function ClientSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [me, setMe] = useState(null);

  const [states, setStates] = useState([]);
  const [lgas, setLgas] = useState([]);
  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    state: "",
    lga: "",
    address: "",
    photoUrl: "",
  });

  // Load me + profile + NG geo
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const [{ data: meData }, { data: geo }] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/geo/ng"),
        ]);
        if (!alive) return;

        setMe(meData || null);
        setStates(geo?.states || []);

        // client profile (route provided by your Profile router)
        let profile = null;
        try {
          const { data } = await api.get("/api/profile/client/me");
          profile = data || null;
        } catch {
          profile = null;
        }

        setForm((cur) => ({
          ...cur,
          displayName:
            profile?.fullName ||
            meData?.displayName ||
            meData?.email ||
            "",
          phone: profile?.phone || meData?.phone || "",
          state: profile?.state || "",
          lga: profile?.lga || meData?.lga || "",
          address: profile?.houseAddress || "",
          photoUrl: profile?.photoUrl || meData?.photoUrl || "",
        }));

        // preload LGAs if state exists
        const st = profile?.state || "";
        if (st) {
          try {
            const { data: lgasData } = await api.get(
              `/api/geo/ng/lgas/${encodeURIComponent(st)}`
            );
            if (alive) setLgas(lgasData || []);
          } catch {
            if (alive) setLgas([]);
          }
        }
      } catch (e) {
        if (alive) setError("Failed to load your settings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function onChangeState(nextState) {
    setForm((f) => ({ ...f, state: nextState, lga: "" }));
    if (!nextState) {
      setLgas([]);
      return;
    }
    try {
      const { data } = await api.get(
        `/api/geo/ng/lgas/${encodeURIComponent(nextState)}`
      );
      setLgas(data || []);
    } catch {
      setLgas([]);
    }
  }

  async function onSave(e) {
    e?.preventDefault?.();
    try {
      setSaving(true);
      setError("");
      setOk("");

      // Persist via your profile router (client endpoint)
      await api.put("/api/profile/client/me", {
        fullName: form.displayName?.trim(),
        phone: form.phone?.trim(),
        state: form.state,
        lga: form.lga,
        houseAddress: form.address?.trim(),
        photoUrl: form.photoUrl || "",
      });

      setOk("Saved!");
    } catch (e) {
      setError("Could not save your changes. Please try again.");
    } finally {
      setSaving(false);
      setTimeout(() => setOk(""), 1800);
    }
  }

  const stateOpts = useMemo(
    () => ["", ...states].map((s) => ({ v: s, t: s || "Select state…" })),
    [states]
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-zinc-400 mb-6">
        Update your personal details used for fast booking.
      </p>

      {loading && <div className="text-zinc-400">Loading…</div>}
      {!loading && (
        <form
          className="rounded-lg border border-zinc-800 p-4 bg-black/40 space-y-6"
          onSubmit={onSave}
        >
          {error && (
            <div className="rounded-md border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
              {error}
            </div>
          )}
          {ok && (
            <div className="rounded-md border border-emerald-800 bg-emerald-900/20 text-emerald-100 px-3 py-2">
              {ok}
            </div>
          )}

          {/* General */}
          <section>
            <h2 className="text-lg font-semibold mb-3">General</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Display Name *">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.displayName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Phone *">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="State *">
                <select
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.state}
                  onChange={(e) => onChangeState(e.target.value)}
                  required
                >
                  {stateOpts.map(({ v, t }) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="LGA *">
                <select
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.lga}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lga: e.target.value }))
                  }
                  disabled={!lgas?.length}
                  required
                >
                  <option value="">
                    {lgas.length ? "Select LGA…" : "Select a state first…"}
                  </option>
                  {lgas.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Address / Landmark">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.address}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, address: e.target.value }))
                  }
                />
              </Field>
              <Field label="User ID">
                <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono break-all">
                  {me?.uid || "—"}
                </div>
              </Field>
            </div>
          </section>

          {/* Payments (lite) */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Payments</h2>
            <p className="text-sm text-zinc-400">
              You’ll add payment only when you book. No card is saved here.
            </p>
          </section>

          {/* Advanced */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Advanced</h2>
            <div className="flex gap-2">
              <a
                href="/deactivate"
                className="text-sm px-3 py-2 rounded-lg border border-red-900 hover:bg-red-900/20"
              >
                Request account deactivation
              </a>
            </div>
          </section>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="rounded-lg bg-gold text-black font-semibold px-4 py-2 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
