import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";

/* ---------- Cloudinary config (frontend env) ---------- */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/* ---------- Services ---------- */
const SERVICE_OPTIONS = [
  "Barbering",
  "Hair Styling (female)",
  "Wig installation",
  "Dreadlock / Locs",
  "Pedicure",
  "Manicure",
  "Nails (extensions/maintenance)",
  "Makeup",
  "Skincare / Facial",
  "Others",
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);         // user document
  const [appDoc, setAppDoc] = useState(null); // professional application/profile doc (optional)
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // General / identity (user-level)
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  // Location (user-level)
  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");

  // Pro toggles
  const [profileVisible, setProfileVisible] = useState(true);
  const [nationwide, setNationwide] = useState(false);
  const [statesCovered, setStatesCovered] = useState([]);

  // Pro details
  const [services, setServices] = useState([]);
  const [years, setYears] = useState("");
  const [hasCert, setHasCert] = useState("no");
  const [certUrl, setCertUrl] = useState("");

  // Gallery
  const [workPhotos, setWorkPhotos] = useState([""]);

  // Payments (Pro)
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bvn, setBvn] = useState("");

  // UI helpers
  const [lightboxUrl, setLightboxUrl] = useState("");
  const okTimerRef = useRef(null);
  const errTimerRef = useRef(null);

  function clearMsg() {
    setErr("");
    setOk("");
    clearTimeout(okTimerRef.current);
    clearTimeout(errTimerRef.current);
  }
  function flashOK(msg) {
    setOk(msg);
    clearTimeout(okTimerRef.current);
    okTimerRef.current = setTimeout(() => setOk(""), 2500);
  }
  const digitsOnly = (s = "") => String(s).replace(/\D/g, "");

  /* ---------- Pull states list for “states you cover” ---------- */
  const [allStates, setAllStates] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!alive) return;
        setAllStates(Array.isArray(data?.states) ? data.states : []);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);
  const stateList = useMemo(() => (allStates || []).slice().sort(), [allStates]);

  function toggleStateCovered(st) {
    setStatesCovered((p) => (p.includes(st) ? p.filter(x => x !== st) : [...p, st]));
  }
  function toggleService(name) {
    setServices((p) => (p.includes(name) ? p.filter(s => s !== name) : [...p, name]));
  }

  /* ---------- Cloudinary widget ---------- */
  const [widgetReady, setWidgetReady] = useState(
    typeof window !== "undefined" && !!window.cloudinary?.createUploadWidget
  );
  useEffect(() => {
    if (widgetReady) return;
    if (typeof window === "undefined") return;

    if (!document.querySelector('script[data-cld="1"]')) {
      const s = document.createElement("script");
      s.src = "https://widget.cloudinary.com/v2.0/global/all.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-cld", "1");
      s.onload = () => setWidgetReady(!!window.cloudinary?.createUploadWidget);
      document.body.appendChild(s);
    }
    const poll = setInterval(() => {
      if (window.cloudinary?.createUploadWidget) {
        setWidgetReady(true);
        clearInterval(poll);
      }
    }, 200);
    const timeout = setTimeout(() => clearInterval(poll), 10000);
    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [widgetReady]);

  const widgetFactory = useMemo(() => {
    return (onSuccess) => {
      if (!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET) return null;
      try {
        return window.cloudinary.createUploadWidget(
          {
            cloudName: CLOUD_NAME,
            uploadPreset: UPLOAD_PRESET, // unsigned
            multiple: false,
            maxFiles: 1,
            clientAllowedFormats: ["jpg","jpeg","png","webp"],
            maxImageFileSize: 5 * 1024 * 1024,
            sources: ["local", "camera", "url"],
            showPoweredBy: false,
            folder: "kpocha/pro-apps",
          },
          (err, res) => {
            if (!err && res && res.event === "success") onSuccess(res.info.secure_url);
          }
        );
      } catch {
        return null;
      }
    };
  }, [widgetReady]);

  /* ---------- Load me (user) + appDoc (pro) ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      clearMsg();
      setLoading(true);
      try {
        const [meRes, proRes] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/pros/me").catch(() => ({ data: null })),
        ]);
        if (!alive) return;

        const meData = meRes.data;
        const app = proRes?.data || null;

        setMe(meData);
        setAppDoc(app);

        // hydrate General (user) fields from user doc primarily; fallback to pro doc
        setDisplayName(meData?.displayName || app?.displayName || meData?.email || "");
        setPhone(meData?.identity?.phone || app?.phone || app?.identity?.phone || "");
        setAvatarUrl(meData?.identity?.photoUrl || app?.identity?.photoUrl || "");

        const lgaUpper = (meData?.identity?.city || app?.lga || app?.identity?.city || "").toString().toUpperCase();
        const stateUpper = (meData?.identity?.state || app?.identity?.state || "").toString().toUpperCase();
        setLga(lgaUpper);
        setStateVal(stateUpper);

        // pro details
        setProfileVisible(Boolean(app?.professional?.profileVisible ?? true));
        setNationwide(Boolean(app?.professional?.nationwide ?? false));
        setStatesCovered(Array.isArray(app?.availability?.statesCovered) ? app.availability.statesCovered : []);
        setServices(Array.isArray(app?.professional?.services) ? app.professional.services : []);
        setYears(app?.professional?.years || "");
        const hc = String(app?.professional?.hasCert || "no");
        setHasCert(hc === "yes" ? "yes" : "no");
        setCertUrl(app?.professional?.certUrl || "");
        setWorkPhotos(
          Array.isArray(app?.professional?.workPhotos) && app.professional.workPhotos.length
            ? app.professional.workPhotos
            : [""]
        );

        // bank
        const bk = app?.bank || {};
        setBankName(bk.bankName || "");
        setAccountName(bk.accountName || "");
        setAccountNumber(String(bk.accountNumber || ""));
        setBvn(String(bk.bvn || ""));
      } catch {
        if (alive) setErr("Failed to load your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(okTimerRef.current);
      clearTimeout(errTimerRef.current);
    };
  }, []);

  /* ---------- Flags & validation ---------- */
  const hasPro = !!appDoc?._id; // gate for pro-only updates — prevents creation from Settings
  const canSaveProfile = useMemo(
    () => !!displayName && !!phone && (!!lga || !!stateVal),
    [displayName, phone, lga, stateVal]
  );
  const canSavePro = useMemo(
    () => hasPro && (services.length > 0 || years || hasCert === "yes" || workPhotos.filter(Boolean).length > 0),
    [hasPro, services, years, hasCert, workPhotos]
  );
  const canSaveBank = useMemo(
    () => hasPro && !!bankName && !!accountName && digitsOnly(accountNumber).length === 10 && digitsOnly(bvn).length >= 10,
    [hasPro, bankName, accountName, accountNumber, bvn]
  );

  /* ---------- Helpers ---------- */
  function withProIdentifiers(base = {}) {
    if (!hasPro) return null;
    const idFields = {
      _id: appDoc?._id,
      uid: me?.uid,
      createdAt: appDoc?.createdAt,
    };
    return { ...base, ...idFields };
  }
  function blockIfNoPro() {
    if (!hasPro) {
      setErr("No professional profile exists yet. Please apply first.");
      return true;
    }
    return false;
  }

  /* ---------- Save handlers ---------- */

  // 1) Save GENERAL PROFILE via Profile router (backend supports this)
  async function saveProfile() {
    clearMsg();
    try {
      const payload = {
        displayName,
        identity: {
          ...(me?.identity || {}),
          phone,
          state: stateVal,
          city: lga,
          photoUrl: avatarUrl,
        },
      };

      // Primary: Profile router
      let res;
      try {
        res = await api.put("/api/profile/me", payload);
      } catch (e) {
        // fallback if router path is slightly different in your tree
        res = await api.put("/api/profile", payload);
      }

      const updated = res?.data?.user || payload;
      setMe((prev) => ({
        ...(prev || {}),
        ...updated,
        identity: { ...(prev?.identity || {}), ...(updated.identity || payload.identity) },
      }));
      flashOK("Profile saved.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save profile.");
    }
  }

  // 2) Save PRO DETAILS to /api/pros/me — ONLY if pro exists
  async function saveProDetails() {
    clearMsg();
    if (blockIfNoPro()) return;
    try {
      const payload = withProIdentifiers({
        ...(appDoc || {}),
        professional: {
          ...(appDoc?.professional || {}),
          services,
          years,
          hasCert,
          certUrl,
          profileVisible,
          nationwide,
          workPhotos,
        },
        availability: {
          ...(appDoc?.availability || {}),
          statesCovered: nationwide ? stateList : statesCovered,
        },
        status: appDoc?.status || "submitted",
      });
      if (!payload) return;

      const { data } = await api.put("/api/pros/me", payload);
      setAppDoc(data?.item || payload);
      flashOK("Professional details saved.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save professional details.");
    }
  }

  // 3) Save BANK to /api/pros/me — ONLY if pro exists
  async function saveBank() {
    clearMsg();
    if (blockIfNoPro()) return;
    try {
      const payload = withProIdentifiers({
        ...(appDoc || {}),
        bank: {
          bankName,
          accountName,
          accountNumber: digitsOnly(accountNumber).slice(0, 10),
          bvn: digitsOnly(bvn).slice(0, 11),
        },
        status: appDoc?.status || "submitted",
      });
      if (!payload) return;

      const { data } = await api.put("/api/pros/me", payload);
      setAppDoc(data?.item || payload);
      flashOK("Payment details saved.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save payment details.");
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Settings</h1>
          <p className="text-zinc-400">Manage your profile and professional details.</p>
        </div>
        {me?.isAdmin && (
          <Link
            to="/admin?tab=settings"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
            title="Open system settings"
          >
            System Settings →
          </Link>
        )}
      </div>

      {err && <div className="mt-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">{err}</div>}
      {ok && <div className="mt-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">{ok}</div>}

      {loading ? (
        <div className="mt-6">Loading…</div>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
              <SectionLink title="General" href="#general" />
              <SectionLink title="Professional Profile" href="#pro" />
              <SectionLink title="Payments" href="#payments" />
              {me?.isAdmin && <SectionLink title="Admin" href="#admin" />}
              <SectionLink title="Advanced" href="#advanced" />
            </div>
          </aside>

          {/* Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Banner if no pro profile */}
            {!hasPro && (
              <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 text-yellow-200 px-4 py-3">
                You don’t have a professional profile yet. You can browse & book as a client, but to
                create or edit a professional profile please{" "}
                <Link to="/become" className="underline text-gold">apply here</Link>.
              </div>
            )}

            {/* General */}
            <section id="general" className="rounded-lg border border-zinc-800 p-4">
              <h2 className="text-lg font-semibold mb-3">General</h2>

              {/* Avatar + name/phone */}
              <div className="flex items-center gap-4 mb-3">
                <Avatar
                  url={avatarUrl}
                  onClick={() => avatarUrl && setLightboxUrl(avatarUrl)}
                />
                <div className="flex items-center gap-2">
                  <UploadButton
                    title={widgetReady ? "Upload Photo" : "Upload (loading…)"}
                    widgetFactory={widgetFactory}
                    onUploaded={setAvatarUrl}
                    disabled={!widgetReady}
                  />
                  {avatarUrl && (
                    <button
                      className="text-xs text-red-300 border border-red-800 rounded px-2 py-1"
                      onClick={() => setAvatarUrl("")}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Display Name" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} required />
                <Input label="Phone" value={phone} onChange={(e)=>setPhone(e.target.value)} required />
              </div>

              <div className="mt-3">
                <Label>State & LGA</Label>
                <NgGeoPicker
                  valueState={stateVal}
                  onChangeState={(st)=>{ /* clear LGA on state change */ setStateVal(st); setLga(""); }}
                  valueLga={lga}
                  onChangeLga={setLga}
                  required
                  className="grid grid-cols-1 gap-3"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mt-4">
                <ReadOnly label="Email" value={me?.email || ""} />
                <ReadOnly
                  label={
                    <span className="inline-flex items-center gap-2">
                      User ID
                      <button
                        onClick={() => { navigator.clipboard.writeText(me?.uid || ""); flashOK("User ID copied."); }}
                        className="text-xs px-2 py-0.5 rounded border border-zinc-700"
                        title="Copy UID"
                      >
                        Copy
                      </button>
                    </span>
                  }
                  value={me?.uid || ""}
                />
              </div>

              <p className="text-xs text-zinc-500 mt-3">
                For Wallet PIN, go to <Link className="underline" to="/wallet">Wallet</Link>.
              </p>

              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSaveProfile}
                  onClick={saveProfile}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Save Profile
                </button>
              </div>
            </section>

            {/* Professional Profile */}
            <section id="pro" className="rounded-lg border border-zinc-800 p-4">
              <h2 className="text-lg font-semibold mb-3">Professional Profile</h2>

              {!appDoc && (
                <div className="text-sm text-zinc-400 mb-3">
                  You haven’t submitted a professional application yet.{" "}
                  <Link to="/become" className="text-gold underline">Apply now →</Link>
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <Label>What services do you offer?</Label>
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" checked={profileVisible} onChange={(e)=>setProfileVisible(e.target.checked)} />
                  Profile visible in search
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SERVICE_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={services.includes(opt)}
                      onChange={() => toggleService(opt)}
                      disabled={!hasPro}
                    />
                    {opt}
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Select
                  label="Years of Experience"
                  value={years}
                  onChange={(e)=>setYears(e.target.value)}
                  options={hasPro ? ["0–1 year","2–4 years","5–10 years","10+ years"] : []}
                  disabled={!hasPro}
                />
                <Select
                  label="Any certification?"
                  value={hasCert}
                  onChange={(e)=>setHasCert(e.target.value)}
                  options={hasPro ? ["no","yes"] : []}
                  disabled={!hasPro}
                />
                {hasCert === "yes" && hasPro && (
                  <div>
                    <Label>Certificate</Label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                        placeholder="Certificate URL"
                        value={certUrl}
                        onChange={(e)=>setCertUrl(e.target.value)}
                      />
                      <UploadButton
                        title={widgetReady ? "Upload" : "Upload (loading…)"}
                        onUploaded={setCertUrl}
                        widgetFactory={widgetFactory}
                        disabled={!widgetReady}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Coverage */}
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={nationwide} onChange={(e)=>setNationwide(e.target.checked)} disabled={!hasPro} />
                  Offer services nationwide (Nigeria)
                </label>
                {!nationwide && (
                  <div className="text-sm">
                    <Label>States you cover</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-auto p-2 border border-zinc-800 rounded">
                      {stateList.map((st) => (
                        <label key={st} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={statesCovered.includes(st)}
                            onChange={()=>toggleStateCovered(st)}
                            disabled={!hasPro}
                          />
                          {st}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Work Photos */}
              <div className="mt-4">
                <Label>Work Photos</Label>
                {workPhotos.map((u, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-2">
                    <input
                      className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                      placeholder={`Photo URL ${idx+1}`}
                      value={u}
                      onChange={(e)=>{
                        const arr=[...workPhotos]; arr[idx]=e.target.value;
                        setWorkPhotos(arr);
                      }}
                      disabled={!hasPro}
                    />
                    <UploadButton
                      title={widgetReady ? "Upload" : "Upload (loading…)"}
                      onUploaded={(url)=>{
                        const arr=[...workPhotos]; arr[idx]=url;
                        setWorkPhotos(arr);
                      }}
                      widgetFactory={widgetFactory}
                      disabled={!widgetReady || !hasPro}
                    />
                    {idx>0 && (
                      <button
                        type="button"
                        className="text-sm text-red-400"
                        onClick={()=> setWorkPhotos(workPhotos.filter((_,i)=>i!==idx))}
                        disabled={!hasPro}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="text-sm text-gold underline"
                  onClick={()=>setWorkPhotos([...workPhotos, ""])}
                  disabled={!hasPro}
                >
                  + Add another
                </button>
              </div>

              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSavePro}
                  onClick={saveProDetails}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Save Professional Details
                </button>
              </div>
            </section>

            {/* Payments */}
            <section id="payments" className="rounded-lg border border-zinc-800 p-4">
              <h2 className="text-lg font-semibold mb-3">Payments</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Bank Name" value={bankName} onChange={(e)=>setBankName(e.target.value)} required disabled={!hasPro} />
                <Input label="Account Name" value={accountName} onChange={(e)=>setAccountName(e.target.value)} required disabled={!hasPro} />
                <Input
                  label="Account Number"
                  value={accountNumber}
                  onChange={(e)=>setAccountNumber(digitsOnly(e.target.value).slice(0,10))}
                  required
                  disabled={!hasPro}
                />
                <Input
                  label="BVN"
                  value={bvn}
                  onChange={(e)=>setBvn(digitsOnly(e.target.value).slice(0,11))}
                  required
                  disabled={!hasPro}
                />
              </div>
              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSaveBank}
                  onClick={saveBank}
                  className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
                >
                  Save Payment Details
                </button>
              </div>
            </section>

            {/* Admin (stub) */}
            {me?.isAdmin && (
              <section id="admin" className="rounded-lg border border-zinc-800 p-4">
                <h2 className="text-lg font-semibold mb-3">Admin</h2>
                <p className="text-sm text-zinc-400">
                  Configure platform rules in{" "}
                  <Link className="underline" to="/admin?tab=settings">System Settings</Link>.
                </p>
              </section>
            )}

            {/* Advanced */}
            <section id="advanced" className="rounded-lg border border-zinc-800 p-4">
              <h2 className="text-lg font-semibold mb-3">Advanced</h2>

              {/* Deactivate link */}
              <div className="flex flex-col gap-2">
                <Link
                  to="/deactivate"
                  className="inline-flex items-center justify-center rounded-lg border border-red-800 text-red-300 px-4 py-2 hover:bg-red-900/20"
                  title="Request account deactivation"
                >
                  Deactivate Account
                </Link>
                <div className="text-xs text-zinc-500">
                  This won’t delete your data immediately. You’ll submit a request and our team will review it.
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Avatar Lightbox */}
      {lightboxUrl && (
        <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl("")} />
      )}
    </div>
  );
}

/* ---------- UI bits ---------- */
function SectionLink({ title, href }) {
  return (
    <a href={href} className="block px-4 py-3 hover:bg-zinc-900/50">
      {title}
    </a>
  );
}
function ReadOnly({ label, value }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300">
        {value || "—"}
      </div>
    </label>
  );
}
function Label({ children }) {
  return <div className="text-sm text-zinc-300 mb-1">{children}</div>;
}
function Input({ label, required, disabled, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <input
        {...props}
        disabled={disabled}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 disabled:opacity-50"
      />
    </label>
  );
}
function Select({ label, options=[], required, disabled, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <select
        {...props}
        disabled={disabled}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 disabled:opacity-50"
      >
        <option value="">{required ? "Select…" : "Select (optional)…"}</option>
        {options.map((o)=> <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function UploadButton({ title="Upload", onUploaded, widgetFactory, disabled }) {
  function open() {
    const widget = widgetFactory?.(onUploaded);
    if (!widget) {
      alert("Upload unavailable. Enter a URL manually.");
      return;
    }
    widget.open();
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={disabled}
      className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 disabled:opacity-50"
      title="Upload with Cloudinary"
    >
      {title}
    </button>
  );
}
function Avatar({ url, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-16 h-16 rounded-full border border-zinc-800 overflow-hidden shrink-0"
      title="Click to enlarge"
    >
      {url ? (
        <img src={url} alt="Avatar" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-500">
          <span className="text-xs">No Photo</span>
        </div>
      )}
    </button>
  );
}
function ImageLightbox({ src, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 max-w-3xl max-h-[85vh] border border-zinc-800 rounded-xl overflow-hidden">
        <img src={src} alt="Preview" className="block max-h-[85vh] object-contain" />
      </div>
    </div>
  );
}
