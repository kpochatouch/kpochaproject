import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import SmartUpload from "../components/SmartUpload.jsx";

export default function ClientSettings() {
  const nav = useNavigate();

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
    username: "",
  });

  // Pull from me + client register (so the page always reflects latest saved details)
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

        // client profile (register data)
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
            (profile?.fullName || meData?.displayName || "").trim() ||
            meData?.email ||
            "",
          phone: profile?.phone || meData?.phone || "",
          state: profile?.state || "",
          lga: profile?.lga || meData?.lga || "",
          address: profile?.houseAddress || profile?.address || "",
          photoUrl: profile?.photoUrl || meData?.photoUrl || "",
          username: meData?.username || meData?.usernameLC || "",
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

      // Persist via the client profile endpoint (same structure as ClientRegister)
      await api.put("/api/profile/client/me", {
        fullName: form.displayName?.trim(),
        phone: form.phone?.trim(),
        state: form.state,
        lga: form.lga,
        houseAddress: form.address?.trim(), // <-- unified key
        photoUrl: form.photoUrl || "",
      });

      // optional: keep /api/me displayName in sync (best-effort)
      try {
        await api.put("/api/profile/me", {
          displayName: form.displayName?.trim() || undefined,
        });
      } catch {}

      setOk("Saved!");
      setTimeout(() => setOk(""), 1200);

      // redirect to profile page after save
      nav("/profile", { replace: true });
    } catch (e) {
      setError("Could not save your changes. Please try again.");
    } finally {
      setSaving(false);
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

            {/* Avatar + upload */}
            <div className="flex items-center gap-3 mb-3">
              <Avatar url={form.photoUrl} />
              <SmartUpload
                title="Upload Photo"
                onUploaded={(url) =>
                  setForm((f) => ({ ...f, photoUrl: url }))
                }
                folder="kpocha/client-avatars"
              />
              {form.photoUrl && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, photoUrl: "" }))}
                  className="text-xs px-2 py-1 rounded border border-red-800 text-red-300"
                >
                  Remove
                </button>
              )}
            </div>

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
              <Field label="Username">
                <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 break-all">
                  {form.username || "—"}
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
function Avatar({ url }) {
  return (
    <div className="relative w-16 h-16 rounded-full border border-zinc-800 overflow-hidden shrink-0">
      {url ? (
        <img src={url} alt="Avatar" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-500">
          <span className="text-xs">No Photo</span>
        </div>
      )}
    </div>
  );
}
