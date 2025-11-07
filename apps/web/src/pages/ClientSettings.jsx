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

  // geo
  const [geo, setGeo] = useState({ states: [], lgas: {} });

  // form state
  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    state: "",
    lga: "",
    address: "",
    photoUrl: "",
    // new:
    agreeTerms: false,
    agreePrivacy: false,
    kycEnabled: false,
    kycIdType: "",
    kycIdUrl: "",
    kycSelfieUrl: "",
  });

  // load
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
        const statesRaw = Array.isArray(geoRes?.data?.states)
          ? geoRes.data.states
          : [];
        const lgasRaw = geoRes?.data?.lgas || {};

        setMe(meData);
        setClient(clientData);
        setPro(proData);
        setGeo({ states: statesRaw, lgas: lgasRaw });

        // pick best source (client → pro → me)
        const base = clientData || proData || meData || {};

        const baseState =
          clientData?.state ||
          clientData?.identity?.state ||
          proData?.identity?.state ||
          meData?.identity?.state ||
          "";
        const baseLga =
          clientData?.lga ||
          clientData?.identity?.city ||
          proData?.identity?.city ||
          meData?.identity?.city ||
          "";

        const normalizedState =
          statesRaw.find(
            (s) => s.toUpperCase() === String(baseState).toUpperCase()
          ) || String(baseState);
        const lgasForState =
          normalizedState && lgasRaw[normalizedState]
            ? lgasRaw[normalizedState]
            : [];
        const normalizedLga =
          lgasForState.find(
            (x) => x.toUpperCase() === String(baseLga).toUpperCase()
          ) || String(baseLga);

        // agreements / kyc from client, if any
        const alreadyTerms =
          !!clientData?.acceptedTerms || !!clientData?.agreements?.terms;
        const alreadyPrivacy =
          !!clientData?.acceptedPrivacy || !!clientData?.agreements?.privacy;
        const kyc = clientData?.kyc || {};

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
          agreeTerms: alreadyTerms,
          agreePrivacy: alreadyPrivacy,
          kycEnabled: !!(kyc?.idType || kyc?.idUrl || kyc?.selfieWithIdUrl),
          kycIdType: kyc?.idType || "",
          kycIdUrl: kyc?.idUrl || "",
          kycSelfieUrl: kyc?.selfieWithIdUrl || "",
        }));
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
    setForm((f) => ({ ...f, [key]: val }));
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
        photoUrl: form.photoUrl || "",
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
          photoUrl: form.photoUrl || "",
        },
      };

      // optional KYC
      if (form.kycEnabled) {
        payload.kyc = {
          idType: form.kycIdType,
          idUrl: form.kycIdUrl,
          selfieWithIdUrl: form.kycSelfieUrl,
          status: "pending",
        };
      }

      let res;
      if (client) {
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
      } else if (pro?._id) {
        // no client doc, but user is pro – update pro + let backend sync profiles
        res = await api.put("/api/pros/me", {
          identity: payload.identity,
          displayName: payload.displayName,
          phone: payload.phone,
        });
        setPro(res?.data?.item || { ...pro, ...payload });
      } else {
        // create/update client doc
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
      }

      // update in-memory me
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

      {loading ? (
        <div className="text-zinc-400">Loading…</div>
      ) : (
        <form
          onSubmit={onSave}
          className="rounded-lg border border-zinc-800 p-4 bg-black/40 space-y-6"
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

          {/* Photo */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Photo</h2>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full overflow-hidden border border-zinc-700 bg-zinc-900">
                {form.photoUrl ? (
                  <img
                    src={form.photoUrl}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">
                    No photo
                  </div>
                )}
              </div>
              <input
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                placeholder="Photo URL"
                value={form.photoUrl}
                onChange={(e) => onChangeField("photoUrl", e.target.value)}
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              (You already have Cloudinary on other pages — you can swap this to
              your upload button if you want.)
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
                  onChange={(e) => onChangeField("address", e.target.value)}
                />
              </Field>
              <Field label="User ID">
                <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono break-all">
                  {me?.uid || "—"}
                </div>
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
              This lets people who registered before these fields existed to
              complete them now.
            </p>
          </section>

          {/* Optional KYC */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              Optional Identity / KYC
            </h2>
            <label className="flex items-center gap-2 text-sm text-zinc-200 mb-3">
              <input
                type="checkbox"
                checked={form.kycEnabled}
                onChange={(e) => onChangeField("kycEnabled", e.target.checked)}
              />
              Add / update my ID details now
            </label>
            {form.kycEnabled && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="ID Type">
                  <select
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    value={form.kycIdType}
                    onChange={(e) =>
                      onChangeField("kycIdType", e.target.value)
                    }
                  >
                    <option value="">Select…</option>
                    <option value="National ID">National ID</option>
                    <option value="Voter’s Card">Voter’s Card</option>
                    <option value="Driver’s License">Driver’s License</option>
                    <option value="International Passport">
                      International Passport
                    </option>
                  </select>
                </Field>
                <Field label="ID Image URL">
                  <input
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    value={form.kycIdUrl}
                    onChange={(e) => onChangeField("kycIdUrl", e.target.value)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Selfie with ID URL">
                  <input
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    value={form.kycSelfieUrl}
                    onChange={(e) =>
                      onChangeField("kycSelfieUrl", e.target.value)
                    }
                    placeholder="https://…"
                  />
                </Field>
              </div>
            )}
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
