// apps/web/src/pages/ClientSettings.jsx
import { useEffect, useMemo, useState } from "react";
import { api, ensureClientProfile } from "../lib/api";
import { uploadMediaAsset } from "../lib/r2Upload";

/* ---------- localStorage keys ---------- */
const DRAFT_KEY = "kpocha:clientSettingsDraft";

export default function ClientSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);
  const [pro, setPro] = useState(null);

  // geo
  const [geo, setGeo] = useState({ states: [], lgas: {} });

  // form state
  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    state: "",
    lga: "",
    address: "",
    photoAssetId: "",
    photoPreviewUrl: "", // UI only, not saved
    agreeTerms: false,
    agreePrivacy: false,
  });

  // helper: save draft
  function saveDraft(nextForm) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(nextForm));
    } catch (_) {}
  }

  // load data
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        await ensureClientProfile(); // ✅ create profile if missing

        const [meRes, geoRes, clientRes, proRes] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/geo/ng"),
          api.get("/api/profile/me"), // client profile
          api.get("/api/pros/me").catch(() => null),
        ]);

        if (!alive) return;

        const meData = meRes?.data || null;
        const clientData = clientRes?.data || {};
        const proData = proRes?.data || null;

        const statesRaw = Array.isArray(geoRes?.data?.states)
          ? geoRes.data.states
          : [];
        const lgasRaw = geoRes?.data?.lgas || {};

        setMe(meData);
        setClient(clientData);
        setPro(proData);
        setGeo({ states: statesRaw, lgas: lgasRaw });

        // load any draft we saved before liveness
        let draft = null;
        try {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) draft = JSON.parse(raw);
        } catch (_) {}

        const base = clientData;

        const baseState =
          clientData?.state ||
          clientData?.identity?.state ||
          proData?.state ||
          proData?.identity?.state ||
          meData?.identity?.state ||
          "";
        const baseLga =
          clientData?.lga ||
          clientData?.identity?.city ||
          proData?.lga ||
          proData?.identity?.city ||
          meData?.identity?.city ||
          "";

        const normalizedState =
          statesRaw.find(
            (s) => s.toUpperCase() === String(baseState).toUpperCase(),
          ) || String(baseState);
        const lgasForState =
          normalizedState && lgasRaw[normalizedState]
            ? lgasRaw[normalizedState]
            : [];
        const normalizedLga =
          lgasForState.find(
            (x) => x.toUpperCase() === String(baseLga).toUpperCase(),
          ) || String(baseLga);

        const alreadyTerms =
          !!clientData?.acceptedTerms || !!clientData?.agreements?.terms;
        const alreadyPrivacy =
          !!clientData?.acceptedPrivacy || !!clientData?.agreements?.privacy;

        // start from server data
        let nextForm = {
          displayName:
            clientData?.fullName ||
            clientData?.displayName ||
            meData?.displayName ||
            meData?.email ||
            "",
          phone:
            clientData?.phone ||
            clientData?.identity?.phone ||
            meData?.identity?.phone ||
            "",
          state: normalizedState || "",
          lga: normalizedLga || "",
          address: clientData?.address || "",
          photoPreviewUrl:
            clientData?.photoUrlResolved ||
            clientData?.photoUrl ||
            proData?.photoUrl ||
            "",
          photoAssetId:
            clientData?.photoAssetId ||
            clientData?.identity?.photoAssetId ||
            "",
          agreeTerms: alreadyTerms,
          agreePrivacy: alreadyPrivacy,
        };

        // if we have draft, overlay it (so user doesn't lose typing)
        if (draft) {
          nextForm = { ...nextForm, ...draft };
        }

        setForm(nextForm);
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

  const lgaOptions = useMemo(() => {
    if (!form.state) return [];
    return geo.lgas[form.state] || [];
  }, [form.state, geo.lgas]);

  function onChangeField(key, val) {
    setForm((f) => {
      const next = { ...f, [key]: val };
      return next;
    });
  }

  async function uploadImageToR2(file) {
    if (!file) return { previewUrl: "", assetId: "" };

    setError("");
    setOk("Uploading image...");

    try {
      const res = await uploadMediaAsset({ api, file, type: "image" });
      const previewUrl = res?.publicUrl || "";
      const assetId = res?.assetId || "";

      if (!assetId) {
        setOk("");
        setError("Upload succeeded but assetId is missing.");
        return { previewUrl, assetId: "" };
      }

      setOk("Uploaded ✓ (click Save changes)");
      setTimeout(() => setOk(""), 1500);

      return { previewUrl, assetId };
    } catch (e) {
      setOk("");
      setError(e?.message || "Upload failed.");
      return { previewUrl: "", assetId: "" };
    }
  }

  async function onSave(e) {
    e?.preventDefault?.();
    try {
      setSaving(true);
      setError("");
      setOk("");

      const stateUP = (form.state || "").toUpperCase();
      const lgaUP = (form.lga || "").toUpperCase();

      const payload = {
        fullName: form.displayName?.trim(),
        displayName: form.displayName?.trim(),
        phone: form.phone?.trim(),
        state: stateUP,
        lga: lgaUP,
        address: form.address?.trim(),
        photoAssetId: form.photoAssetId || "",
        acceptedTerms: !!form.agreeTerms,
        acceptedPrivacy: !!form.agreePrivacy,
        agreements: {
          terms: !!form.agreeTerms,
          privacy: !!form.agreePrivacy,
        },
        identity: {
          phone: form.phone?.trim(),
          state: stateUP,
          city: lgaUP,
          photoAssetId: form.photoAssetId || "",
        },
      };

      const res = await api.put("/api/profile/me", payload);
      const updated = res?.data || payload;
      setClient(updated);

      // clear draft on successful save
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}

      setMe((prev) => ({
        ...(prev || {}),
        displayName: payload.displayName,
        identity: {
          ...(prev?.identity || {}),
          phone: payload.phone,
          state: payload.state,
          city: payload.lga,
          photoAssetId: payload.photoAssetId,
        },
      }));

      setOk("Saved!");
      setTimeout(() => setOk(""), 2000);
    } catch (e) {
      setError(e?.response?.data?.error || "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Client Settings</h1>
      <p className="text-zinc-400 mb-6">
        Complete or update your personal profile.
      </p>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-900/30 text-red-100 px-3 py-2 mb-4">
          {error}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-emerald-800 bg-emerald-900/20 text-emerald-100 px-3 py-2 mb-4">
          {ok}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-400">Loading…</div>
      ) : (
        <form
          onSubmit={onSave}
          className="rounded-lg border border-zinc-800 p-4 bg-black/40 space-y-6"
        >
          {/* Photo (no separate verify button anymore) */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Photo</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-14 h-14 rounded-full overflow-hidden border border-zinc-700 bg-zinc-900">
                {form.photoPreviewUrl ? (
                  <img
                    src={form.photoPreviewUrl}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">
                    No photo
                  </div>
                )}
              </div>
              <label className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 cursor-pointer">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    const out = await uploadImageToR2(file);
                    if (out.assetId) {
                      onChangeField("photoAssetId", out.assetId);
                      if (out.previewUrl)
                        onChangeField("photoPreviewUrl", out.previewUrl);
                    }
                  }}
                />
              </label>
              {(form.photoPreviewUrl || form.photoAssetId) && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeField("photoAssetId", "");
                    onChangeField("photoPreviewUrl", "");
                  }}
                  className="px-3 py-2 rounded-lg border border-red-800 text-red-200 text-sm hover:bg-red-900/20"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              This photo is shared across your account (client view).
            </p>
          </section>

          {/* General */}
          <section>
            <h2 className="text-lg font-semibold mb-3">General</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Full / Display Name *">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.displayName}
                  onChange={(e) => onChangeField("displayName", e.target.value)}
                  required
                />
              </Field>
              <Field label="Phone *">
                <input
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.phone}
                  onChange={(e) => onChangeField("phone", e.target.value)}
                  required
                />
              </Field>
              <Field label="State *">
                <select
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.state}
                  onChange={(e) => {
                    onChangeField("state", e.target.value);
                    onChangeField("lga", "");
                  }}
                  required
                >
                  <option value="">Select state…</option>
                  {geo.states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="LGA *">
                <select
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  value={form.lga}
                  onChange={(e) => onChangeField("lga", e.target.value)}
                  disabled={!lgaOptions.length}
                  required
                >
                  <option value="">
                    {lgaOptions.length
                      ? "Select LGA…"
                      : "Select a state first…"}
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
                  onChange={(e) => onChangeField("address", e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* Agreements */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Agreements</h2>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={form.agreeTerms}
                onChange={(e) => onChangeField("agreeTerms", e.target.checked)}
              />
              I agree to the Terms &amp; Conditions
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-200 mt-2">
              <input
                type="checkbox"
                checked={form.agreePrivacy}
                onChange={(e) =>
                  onChangeField("agreePrivacy", e.target.checked)
                }
              />
              I agree to the Privacy Policy
            </label>
            <p className="text-xs text-zinc-500 mt-1">
              Old accounts can use this page to accept current terms.
            </p>
          </section>

          <div className="pt-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-200 text-black font-semibold px-4 py-2 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
          {/* System (notifications) */}
          <section className="pt-6 border-t border-zinc-800">
            <h2 className="text-lg font-semibold mb-2">System</h2>
            <p className="text-xs text-zinc-500 mb-3">
              Use this if you keep getting Chrome notifications in addition to
              the app.
            </p>

            <button
              type="button"
              className="w-full px-4 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900 text-sm"
              onClick={async () => {
                try {
                  await api.post("/api/push/unsubscribe");
                } catch {}

                try {
                  if ("serviceWorker" in navigator) {
                    const reg = await navigator.serviceWorker.ready;
                    const sub = await reg.pushManager.getSubscription();
                    if (sub) await sub.unsubscribe();
                  }
                } catch {}

                alert(
                  "Browser (Chrome/PWA) notifications disabled for this account on this device.",
                );
              }}
            >
              Disable Chrome / Browser notifications
            </button>

            <div className="text-[11px] text-zinc-500 mt-2">
              This does not edit your profile. It only affects browser/PWA push.
            </div>
          </section>
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
