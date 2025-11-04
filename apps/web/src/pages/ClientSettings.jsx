// apps/web/src/pages/ClientSettings.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export default function ClientSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);
  const [pro, setPro] = useState(null);

  // geo (single load, same shape as NgGeoPicker)
  const [geo, setGeo] = useState({ states: [], lgas: {} });
  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    state: "",
    lga: "",
    address: "",
    photoUrl: "",
  });

  // ✅ Load user data (single UID) + client + pro + geo
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");

        const [meRes, geoRes, clientRes, proRes] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/geo/ng"),
          api.get("/api/profile/me").catch(() => null),
          api.get("/api/pros/me").catch(() => null),
        ]);
        if (!alive) return;

        const meData = meRes?.data || null;
        const clientData = clientRes?.data || null;
        const proData = proRes?.data || null;
        const statesRaw = Array.isArray(geoRes?.data?.states) ? geoRes.data.states : [];
        const lgasRaw = geoRes?.data?.lgas || {};

        setMe(meData);
        setClient(clientData);
        setPro(proData);
        setGeo({ states: statesRaw, lgas: lgasRaw });

        // 2️⃣ Auto-fill with priority: client → pro → me → fallback
        const base = clientData || proData || meData || {};

        const baseStateRaw =
          clientData?.state ||
          clientData?.identity?.state ||
          proData?.identity?.state ||
          meData?.identity?.state ||
          "";
        const baseLgaRaw =
          clientData?.lga ||
          clientData?.identity?.city ||
          proData?.identity?.city ||
          meData?.identity?.city ||
          "";

        // match incoming state to the actual list (ignoring case)
        const normalizedState =
          statesRaw.find((s) => s.toUpperCase() === String(baseStateRaw).toUpperCase()) ||
          String(baseStateRaw);

        // same for LGA if we have a state
        const lgasForState =
          normalizedState && lgasRaw[normalizedState]
            ? lgasRaw[normalizedState]
            : [];
        const normalizedLga =
          lgasForState.find((x) => x.toUpperCase() === String(baseLgaRaw).toUpperCase()) ||
          String(baseLgaRaw);

        setForm((cur) => ({
          ...cur,
          displayName:
            clientData?.fullName ||
            clientData?.displayName ||
            base.displayName ||
            base.fullName ||
            meData?.email ||
            "",
          phone:
            clientData?.phone ||
            clientData?.identity?.phone ||
            proData?.phone ||
            proData?.identity?.phone ||
            meData?.phone ||
            meData?.identity?.phone ||
            "",
          state: normalizedState || "",
          lga: normalizedLga || "",
          address: clientData?.address || "",
          photoUrl:
            clientData?.photoUrl ||
            clientData?.identity?.photoUrl ||
            proData?.identity?.photoUrl ||
            meData?.identity?.photoUrl ||
            "",
        }));
      } catch {
        if (alive) setError("Failed to load your settings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // derived lgas for selected state
  const lgaOptions = useMemo(() => {
    if (!form.state) return [];
    return geo.lgas[form.state] || [];
  }, [form.state, geo.lgas]);

  // ✅ Change state → clear LGA and show local options
  function onChangeState(nextState) {
    setForm((f) => ({ ...f, state: nextState, lga: "" }));
  }

  // ✅ Save profile (keeps same UID, upserts)
  async function onSave(e) {
    e?.preventDefault?.();
    try {
      setSaving(true);
      setError("");
      setOk("");

      // store in uppercase to match API + Pro layer
      const stateUP = (form.state || "").toUpperCase();
      const lgaUP = (form.lga || "").toUpperCase();

      const payload = {
        fullName: form.displayName?.trim(),
        displayName: form.displayName?.trim(),
        phone: form.phone?.trim(),
        state: stateUP,
        lga: lgaUP,
        address: form.address?.trim(),
        photoUrl: form.photoUrl || "",
        identity: {
          phone: form.phone?.trim(),
          state: stateUP,
          city: lgaUP,
          photoUrl: form.photoUrl || "",
        },
      };

      let res;
      if (client) {
        // ✅ client exists → write to client profile
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
      } else if (pro?._id) {
        // ✅ no client but pro exists → write to pro doc
        res = await api.put("/api/pros/me", {
          ...pro,
          displayName: payload.displayName,
          phone: payload.phone,
          identity: payload.identity,
        });
        setPro(res?.data?.item || { ...pro, ...payload });
      } else {
        // ✅ no client, no pro → create client profile
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
      }

      // keep /api/me in sync in UI
      setMe((prev) => ({
        ...(prev || {}),
        displayName: payload.displayName,
        identity: {
          ...(prev?.identity || {}),
          phone: payload.phone,
          state: payload.state,
          city: payload.lga,
          photoUrl: payload.photoUrl,
        },
      }));

      setOk("Saved!");
    } catch {
      setError("Could not save your changes. Please try again.");
    } finally {
      setSaving(false);
      setTimeout(() => setOk(""), 1800);
    }
  }

  const stateOpts = useMemo(
    () => ["", ...geo.states].map((s) => ({ v: s, t: s || "Select state…" })),
    [geo.states]
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

          {/* GENERAL */}
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
                  disabled={!lgaOptions?.length}
                  required
                >
                  <option value="">
                    {lgaOptions.length ? "Select LGA…" : "Select a state first…"}
                  </option>
                  {lgaOptions.map((x) => (
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

          {/* PAYMENTS */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Payments</h2>
            <p className="text-sm text-zinc-400">
              You’ll add payment only when you book. No card is saved here.
            </p>
          </section>

          {/* ADVANCED */}
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
