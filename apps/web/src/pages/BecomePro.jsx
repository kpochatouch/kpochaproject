// apps/web/src/pages/BecomePro.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, submitProApplication } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import ServicePicker from "../components/ServicePicker.jsx";

/* ---------- Cloudinary (frontend env) ---------- */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/* ---------- Utils ---------- */
function digitsOnly(s = "") {
  return String(s).replace(/\D/g, "");
}
function parseMoney(input = "") {
  // Accept "15,000" or "15000" or "" -> "0"
  const cleaned = String(input).replace(/,/g, "").trim();
  if (!cleaned) return "0";
  return cleaned;
}
function formatMoneyForInput(s = "") {
  // display with commas while typing; keep empty as-is
  const cleaned = String(s).replace(/,/g, "");
  if (cleaned === "") return "";
  const [whole, frac] = cleaned.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac != null ? `${withCommas}.${frac}` : withCommas;
}
function normName(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").replace(/[^\w ]+/g, "").trim();
}

/* ---------- Upload widget helper ---------- */
function useCloudinaryWidget() {
  const [ready, setReady] = useState(!!window.cloudinary?.createUploadWidget);
  useEffect(() => {
    if (ready) return;
    if (!document.querySelector('script[data-cld="1"]')) {
      const s = document.createElement("script");
      s.src = "https://widget.cloudinary.com/v2.0/global/all.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-cld", "1");
      s.onload = () => setReady(!!window.cloudinary?.createUploadWidget);
      document.body.appendChild(s);
    }
    const t = setInterval(() => {
      if (window.cloudinary?.createUploadWidget) {
        setReady(true);
        clearInterval(t);
      }
    }, 200);
    const stopAfter = setTimeout(() => clearInterval(t), 10000);
    return () => { clearInterval(t); clearTimeout(stopAfter); };
  }, [ready]);

  const factory = (onSuccess, folder = "kpocha/pro-apps") => {
    if (!ready || !CLOUD_NAME || !UPLOAD_PRESET) return null;
    try {
      return window.cloudinary.createUploadWidget(
        {
          cloudName: CLOUD_NAME,
          uploadPreset: UPLOAD_PRESET,
          multiple: false,
          maxFiles: 1,
          clientAllowedFormats: ["jpg","jpeg","png","webp"],
          maxImageFileSize: 5 * 1024 * 1024,
          sources: ["local", "camera", "url"],
          showPoweredBy: false,
          folder,
        },
        (err, res) => {
          if (!err && res && res.event === "success") onSuccess(res.info.secure_url);
        }
      );
    } catch {
      return null;
    }
  };

  return { ready, factory };
}

/* ======================= BecomePro Page ======================= */
export default function BecomePro() {
  const nav = useNavigate();
  const { ready: widgetReady, factory: widgetFactory } = useCloudinaryWidget();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // ===== Identity
  const [identity, setIdentity] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gender: "",
    dob: "",
    phone: "",           // OPTIONAL (OTP disabled in env)
    whatsapp: "",
    email: "",
    state: "",
    lga: "",
    photoUrl: "",        // OPTIONAL (upload + URL fallback)
    lat: "",
    lon: "",
  });

  // ===== Professional meta
  const [professional, setProfessional] = useState({
    years: "",
    workPhotos: [""],
    hasCert: "no",
    certUrl: "",
    profileVisible: true,
    nationwide: false,
  });

  // ===== Services & pricing (dynamic rows)
  // Each row: { id, name, price, promoPrice, otherText }
  const [servicesDetailed, setServicesDetailed] = useState([
    { id: "", name: "", price: "", promoPrice: "", otherText: "" },
  ]);

  // ===== Business
  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",
    shopPhotoOutside: "",
    shopPhotoInside: "",
    lat: "",
    lon: "",
  });

  // ===== Availability
  const [availability, setAvailability] = useState({
    days: { Mon:false, Tue:false, Wed:false, Thu:false, Fri:false, Sat:false, Sun:false },
    start: "",
    end: "",
    emergency: "no",
    homeService: "no",
    homeServicePrice: "",
    statesCovered: [],
  });

  // ===== Verification
  const [verification, setVerification] = useState({
    idType: "",
    idUrl: "",
    selfieWithIdUrl: "",          // required (from /liveness OR manual fallback)
    livenessVideoUrl: "",         // OPTIONAL RESERVED (empty; ignored by validation)
    livenessMetrics: {},          // set by liveness
  });
  const [showManualSelfie, setShowManualSelfie] = useState(false); // hidden fallback toggle

  // ===== Bank
  const [bank, setBank] = useState({
    bankName: "",
    accountName: "",
    accountNumber: "",
    bvn: "",
  });

  // ===== Portfolio
  const [portfolio, setPortfolio] = useState({
    instagram: "",
    tiktok: "",
    facebook: "",
    website: "",
    testimonials: "",
  });

  const [agreements, setAgreements] = useState({ terms: false, privacy: false });

  // Prefill email
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        setIdentity((p) => ({ ...p, email: data?.email || p.email }));
      } catch {}
    })();
  }, []);

  // ===== Pull Nigeria states for picker + nationwide logic
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

  /* -------- GPS: Use my location -------- */
  async function useMyLocation() {
    try {
      setMsg("");
      if (!("geolocation" in navigator)) {
        setMsg("Your browser does not support geolocation.");
        return;
      }
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      }).then(async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));

        setBusiness((b) => ({ ...b, lat, lon }));
        setIdentity((i) => ({ ...i, lat, lon }));

        try {
          const { data } = await api.get(`/api/geo/rev?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
          const props = data?.features?.[0]?.properties || {};
          const guessedState = String(props.state || props.region || "").toUpperCase();
          const guessedLga = String(props.county || props.city || props.district || props.suburb || "").toUpperCase();
          const formatted = props.formatted || "";

          setIdentity((prev) => ({
            ...prev,
            state: prev.state || guessedState || prev.state,
            lga: prev.lga || guessedLga || prev.lga,
          }));

          setBusiness((prev) => ({
            ...prev,
            shopAddress: prev.shopAddress || formatted || prev.shopAddress,
          }));
        } catch {}
      });
    } catch (err) {
      setMsg(err?.message || "Failed to get your location.");
    }
  }

  /* ---------- Liveness integration (page-based) ----------
   * LivenessPage.jsx should set:
   *  localStorage['kpocha:selfieUrl'] = <url>
   *  localStorage['kpocha:livenessMetrics'] = JSON.stringify({blink, turnLeft, turnRight, ts})
   *  localStorage['kpocha:livenessVideoUrl'] = "" (reserved; optional)
   */
  function checkLivenessStorage() {
    try {
      const url = localStorage.getItem("kpocha:selfieUrl") || "";
      const metricsRaw = localStorage.getItem("kpocha:livenessMetrics");
      const videoUrl = localStorage.getItem("kpocha:livenessVideoUrl") || "";
      if (url || videoUrl) {
        setVerification((v) => ({
          ...v,
          selfieWithIdUrl: url || v.selfieWithIdUrl,
          livenessMetrics: metricsRaw ? JSON.parse(metricsRaw) : (v.livenessMetrics || {}),
          livenessVideoUrl: videoUrl || v.livenessVideoUrl || "",
        }));
        // Clear so we don’t reuse stale values later
        localStorage.removeItem("kpocha:selfieUrl");
        localStorage.removeItem("kpocha:livenessMetrics");
        localStorage.removeItem("kpocha:livenessVideoUrl");
      }
    } catch {}
  }
  useEffect(() => {
    const onFocus = () => checkLivenessStorage();
    const onVisibility = () => { if (document.visibilityState === "visible") checkLivenessStorage(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /* ---------- Services rows helpers ---------- */
  function updateRow(i, patch) {
    setServicesDetailed((rows) => {
      const next = rows.slice();
      next[i] = { ...next[i], ...patch };
      // keep pretty commas while typing
      if (patch?.price !== undefined) {
        next[i].price = formatMoneyForInput(next[i].price);
      }
      if (patch?.promoPrice !== undefined) {
        next[i].promoPrice = formatMoneyForInput(next[i].promoPrice);
      }
      return next;
    });
  }
  function onPickService(i, value, meta) {
    // meta = { id, name, price? }
    const isOther = value === "other";
    updateRow(i, {
      id: isOther ? "other" : meta?.id || value || "",
      name: isOther ? "" : (meta?.name || value || ""),
    });
  }
  function onOtherText(i, txt) {
    updateRow(i, { otherText: txt, name: txt });
  }
  function addRow() {
    setServicesDetailed((r) => [...r, { id: "", name: "", price: "", promoPrice: "", otherText: "" }]);
  }
  function removeRow(i) {
    setServicesDetailed((r) => r.filter((_, idx) => idx !== i));
  }

  /* ---------- Validation ---------- */
  const missing = useMemo(() => {
    const m = [];

    // Identity required
    if (!identity.firstName) m.push("First name");
    if (!identity.lastName) m.push("Last name");
    if (!identity.gender) m.push("Gender");
    if (!identity.dob) m.push("Date of birth");
    if (!identity.state) m.push("State");
    if (!professional.nationwide && !identity.lga) m.push("LGA (or select Nationwide)");

    // At least one valid service row
    const resolvedRows = servicesDetailed
      .map((r) => ({ ...r, resolvedName: (r.name || "").trim() }))
      .filter((r) => r.resolvedName);
    if (resolvedRows.length === 0) m.push("At least one service");

    // No duplicate service names
    const seen = new Set();
    for (const r of resolvedRows) {
      const key = normName(r.resolvedName);
      if (seen.has(key)) { m.push("Duplicate service names"); break; }
      seen.add(key);
    }

    // Verification required
if (!verification.idType) m.push("ID type");
if (!verification.idUrl) m.push("Government ID image");
// Liveness selfie is OPTIONAL for now — camera not reliable
// if (!verification.selfieWithIdUrl) m.push("Liveness selfie");


    // Bank required
    if (!bank.bankName) m.push("Bank name");
    if (!bank.accountName) m.push("Account name");
    if (!bank.accountNumber) m.push("Account number");
    if (!bank.bvn) m.push("BVN");

    // Agreements
    if (!agreements.terms) m.push("Accept Terms");
    if (!agreements.privacy) m.push("Accept Privacy Policy");

    return m;
  }, [
    identity.firstName, identity.lastName, identity.gender, identity.dob, identity.state, identity.lga, professional.nationwide,
    servicesDetailed, verification.idType, verification.idUrl, verification.selfieWithIdUrl,
    bank.bankName, bank.accountName, bank.accountNumber, bank.bvn,
    agreements.terms, agreements.privacy
  ]);

  const canSubmit = missing.length === 0;

  /* ---------- Submit ---------- */
  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) {
      setMsg(`Please complete: ${missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const topLat = business.lat || identity.lat || "";
      const topLon = business.lon || identity.lon || "";

      // normalize services: default blank price to "0", strip commas
      const normalizedRows = servicesDetailed
        .map(r => {
          const name = (r.name || "").trim();
          if (!name) return null;
          const price = parseMoney(r.price);
          const promoPrice = r.promoPrice ? parseMoney(r.promoPrice) : "";
          return {
            id: r.id || "other",
            name,
            price: price === "" ? "0" : price,
            ...(promoPrice !== "" ? { promoPrice } : {}),
          };
        })
        .filter(Boolean);

      const payload = {
        ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
        identity: {
          ...identity,
          ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
        },
        professional: {
          ...professional,
          // maintain legacy "services" as unique names (from rows)
          services: Array.from(new Set(normalizedRows.map(r => r.name))),
        },
        business: {
          ...business,
          ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
        },
        availability: {
          ...availability,
          statesCovered: professional.nationwide ? stateList : availability.statesCovered,
        },
        // NEW canonical list
        servicesDetailed: normalizedRows,

        verification: {
          ...verification,
          // keep the optional reserved video field present but empty by default
          livenessVideoUrl: verification.livenessVideoUrl || "",
        },

        bank: {
          ...bank,
          accountNumber: digitsOnly(bank.accountNumber).slice(0, 10),
          bvn: digitsOnly(bank.bvn).slice(0, 11),
        },
        portfolio,
        status: "submitted",
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: { terms: !!agreements.terms, privacy: !!agreements.privacy },
      };

      await submitProApplication(payload);
      nav("/apply/thanks");
    } catch (err) {
      const apiMsg =
        err?.response?.data?.error ||
        (err?.response?.status === 409
          ? "You already have an active or pending application."
          : "Failed to submit application.");
      setMsg(apiMsg);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6 text-yellow-400">Professional Application</h2>
      {msg && <div className="mb-4 text-sm text-red-400">{msg}</div>}

      {/* Live missing reasons */}
      {missing.length > 0 && (
        <div className="mb-4 border border-yellow-500/50 rounded-lg p-3 bg-black text-yellow-300">
          <div className="text-sm font-semibold mb-1">Missing:</div>
          <ul className="text-sm list-disc pl-5 space-y-1">
            {missing.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      <form onSubmit={submit} className="space-y-8">

        {/* SECTION: Identity */}
        <Section title="Identity & Contact">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="First Name *" value={identity.firstName} onChange={(e)=>setIdentity({...identity, firstName: e.target.value})} />
            <Input label="Middle Name" value={identity.middleName} onChange={(e)=>setIdentity({...identity, middleName: e.target.value})} />
            <Input label="Last Name *" value={identity.lastName} onChange={(e)=>setIdentity({...identity, lastName: e.target.value})} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select
              label="Gender *"
              value={identity.gender}
              onChange={(e)=>setIdentity({...identity, gender: e.target.value})}
              options={["Male","Female","Other"]}
            />
            <Input label="Date of Birth *" type="date" value={identity.dob} onChange={(e)=>setIdentity({...identity, dob: e.target.value})} />
            <Input label="Email" type="email" value={identity.email} onChange={(e)=>setIdentity({...identity, email: e.target.value})} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Input label="Phone (optional)" value={identity.phone} onChange={(e)=>setIdentity({...identity, phone: e.target.value})} />
            <Input label="WhatsApp (optional)" value={identity.whatsapp} onChange={(e)=>setIdentity({...identity, whatsapp: e.target.value})} />
            <div>
              <Label>Profile Photo (optional)</Label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                  placeholder="Photo URL"
                  value={identity.photoUrl}
                  onChange={(e)=>setIdentity({...identity, photoUrl: e.target.value})}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url)=>setIdentity({...identity, photoUrl: url})}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET}
                />
              </div>
              {(!CLOUD_NAME || !UPLOAD_PRESET) && (
                <p className="text-xs text-zinc-500 mt-1">Upload widget not configured — the URL field is the fallback.</p>
              )}
            </div>
          </div>

          {/* State/LGA + nationwide */}
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-yellow-300">
              <input
                type="checkbox"
                checked={professional.nationwide}
                onChange={(e)=>setProfessional({...professional, nationwide: e.target.checked})}
              />
              Offer services nationwide (Nigeria)
            </label>

            <NgGeoPicker
              valueState={identity.state}
              onChangeState={(st) => {
                setIdentity({ ...identity, state: st, lga: "" });
                if (st && !professional.nationwide) {
                  setAvailability((p)=>({
                    ...p,
                    statesCovered: p.statesCovered.includes(st) ? p.statesCovered : [...p.statesCovered, st]
                  }));
                }
              }}
              valueLga={identity.lga}
              onChangeLga={(lga) => setIdentity({ ...identity, lga })}
              required
              className="grid grid-cols-1 gap-3"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Latitude (optional)" value={business.lat} onChange={(e)=>setBusiness({...business, lat: e.target.value})} placeholder="e.g. 6.5244" />
              <Input label="Longitude (optional)" value={business.lon} onChange={(e)=>setBusiness({...business, lon: e.target.value})} placeholder="e.g. 3.3792" />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={useMyLocation}
                  className="w-full px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10"
                >
                  Use my location
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* SECTION: Services & Pricing (optional prices) */}
        <Section title="Services & Pricing">
          <p className="text-xs text-zinc-400 mb-2">
            Add at least one service. Price and Promo Price are optional; leaving price blank means ₦0 (free add-on).
          </p>

          <div className="space-y-3">
            {servicesDetailed.map((row, i) => {
              const isOther = row.id === "other";
              return (
                <div key={i} className="border border-yellow-500/40 rounded-lg p-3 bg-black">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label>Service</Label>
                      <ServicePicker
                        value={row.id || row.name}
                        onChange={(value, meta)=>onPickService(i, value, meta)}
                        includeOther={true}
                        otherText={row.otherText}
                        onOtherText={(txt)=>onOtherText(i, txt)}
                        className=""
                      />
                      {isOther && (
                        <p className="text-xs text-zinc-500 mt-1">Please specify the custom service name above.</p>
                      )}
                    </div>

                    <div>
                      <Label>Price (₦) — optional</Label>
                      <input
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                        inputMode="decimal"
                        placeholder="e.g. 15,000"
                        value={row.price}
                        onChange={(e)=>updateRow(i, { price: e.target.value })}
                      />
                      <p className="text-[11px] text-zinc-500 mt-1">You can type numbers with commas for clarity.</p>
                    </div>

                    <div>
                      <Label>Promo Price (₦) — optional</Label>
                      <input
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                        inputMode="decimal"
                        placeholder="e.g. 12,000"
                        value={row.promoPrice}
                        onChange={(e)=>updateRow(i, { promoPrice: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end mt-2">
                    {servicesDetailed.length > 1 && (
                      <button
                        type="button"
                        className="text-sm text-red-400 hover:text-red-300"
                        onClick={()=>removeRow(i)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            <button type="button" onClick={addRow}
              className="px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10">
              + Add another service
            </button>
          </div>
        </Section>

        {/* SECTION: Business */}
        <Section title="Business Information">
          <Select
            label="Work Mode"
            value={business.mode}
            onChange={(e)=>setBusiness({...business, mode: e.target.value})}
            options={["shop","home","both"]}
          />

          {(business.mode === "shop" || business.mode === "both") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Input label="Business / Shop Name" value={business.shopName} onChange={(e)=>setBusiness({...business, shopName: e.target.value})} />
              <Input label="Business Address" value={business.shopAddress} onChange={(e)=>setBusiness({...business, shopAddress: e.target.value})} />

              <UploadRow
                label="Photo (outside)"
                value={business.shopPhotoOutside}
                onChange={(v)=>setBusiness({...business, shopPhotoOutside: v})}
                widgetFactory={widgetFactory}
                widgetReady={widgetReady}
                folder="kpocha/pro-apps/shops"
              />
              <UploadRow
                label="Photo (inside)"
                value={business.shopPhotoInside}
                onChange={(v)=>setBusiness({...business, shopPhotoInside: v})}
                widgetFactory={widgetFactory}
                widgetReady={widgetReady}
                folder="kpocha/pro-apps/shops"
              />
            </div>
          )}
        </Section>

        {/* SECTION: Availability */}
        <Section title="Work Availability">
          <Label>Working Days</Label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-sm text-yellow-300">
            {Object.keys(availability.days).map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={availability.days[d]}
                  onChange={()=>setAvailability((p)=>({ ...p, days: { ...p.days, [d]: !p.days[d] } }))}
                />
                {d}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Input label="Start time" type="time" value={availability.start} onChange={(e)=>setAvailability({...availability, start: e.target.value})} />
            <Input label="End time" type="time" value={availability.end} onChange={(e)=>setAvailability({...availability, end: e.target.value})} />
            <Select label="Emergency service?" value={availability.emergency} onChange={(e)=>setAvailability({...availability, emergency:e.target.value})} options={["no","yes"]} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select label="Home service?" value={availability.homeService} onChange={(e)=>setAvailability({...availability, homeService:e.target.value})} options={["no","yes"]} />
            {availability.homeService === "yes" && (
              <Input
                label="Home service starting price (₦)"
                value={availability.homeServicePrice}
                onChange={(e)=>setAvailability({...availability, homeServicePrice: formatMoneyForInput(e.target.value)})}
                placeholder="e.g. 10,000"
              />
            )}
          </div>
        </Section>

        {/* SECTION: Identity Verification */}
        <Section title="Identity Verification">
          <Select label="ID Type *" value={verification.idType} onChange={(e)=>setVerification({...verification, idType: e.target.value})}
            options={["National ID","Voter’s Card","Driver’s License","International Passport"]} />

          <UploadRow
            label="Government ID *"
            value={verification.idUrl}
            onChange={(v)=>setVerification({...verification, idUrl: v})}
            widgetFactory={widgetFactory}
            widgetReady={widgetReady}
            folder="kpocha/pro-apps/ids"
          />

          <div className="mt-3">
            <Label>Liveness (Selfie) (optional)</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10"
                onClick={() => nav("/liveness")}
                title="Open active camera page"
              >
                Open Liveness Camera
              </button>

              {verification.selfieWithIdUrl ? (
              <span className="text-xs text-emerald-400">Captured ✓</span>
              ) : (
              <span className="text-xs text-zinc-500">Optional — you can submit without it</span>
              )}


              {/* Hidden fallback (revealed only when needed) */}
              {!verification.selfieWithIdUrl && (
                <button
                  type="button"
                  className="ml-2 text-xs underline text-zinc-400 hover:text-zinc-200"
                  onClick={()=>setShowManualSelfie(true)}
                >
                  Manual selfie URL (fallback)
                </button>
              )}
            </div>

            {showManualSelfie && !verification.selfieWithIdUrl && (
              <div className="mt-2">
                <input
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                  placeholder="Paste selfie image URL (fallback)"
                  value={verification.selfieWithIdUrl}
                  onChange={(e)=>setVerification({...verification, selfieWithIdUrl: e.target.value})}
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Use this only if the camera or upload fails. Liveness remains required.
                </p>
              </div>
            )}
          </div>

          {/* Optional reserved: keep the field present but not validated */}
          <div className="mt-2 hidden">
            <Input
              label="(Optional reserved) Liveness Video URL"
              value={verification.livenessVideoUrl}
              onChange={(e)=>setVerification({...verification, livenessVideoUrl: e.target.value})}
              placeholder="(future support)"
            />
          </div>
        </Section>

        {/* SECTION: Bank Details */}
        <Section title="Bank Details">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Bank Name *" value={bank.bankName} onChange={(e)=>setBank({...bank, bankName: e.target.value})} />
            <Input label="Account Name *" value={bank.accountName} onChange={(e)=>setBank({...bank, accountName: e.target.value})} />
            <Input
              label="Account Number *"
              value={bank.accountNumber}
              onChange={(e)=>setBank({...bank, accountNumber: e.target.value})}
              placeholder="10 digits"
            />
            <Input
              label="BVN *"
              value={bank.bvn}
              onChange={(e)=>setBank({...bank, bvn: e.target.value})}
              placeholder="11 digits"
            />
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">We’ll validate digits on submit.</p>
        </Section>

        {/* SECTION: Social / Portfolio */}
        <Section title="Social / Portfolio (optional)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Instagram" value={portfolio.instagram} onChange={(e)=>setPortfolio({...portfolio, instagram: e.target.value})} />
            <Input label="TikTok" value={portfolio.tiktok} onChange={(e)=>setPortfolio({...portfolio, tiktok: e.target.value})} />
            <Input label="Facebook" value={portfolio.facebook} onChange={(e)=>setPortfolio({...portfolio, facebook: e.target.value})} />
            <Input label="Website / Portfolio" value={portfolio.website} onChange={(e)=>setPortfolio({...portfolio, website: e.target.value})} />
          </div>
          <textarea
            className="w-full mt-3 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
            placeholder="Testimonials / Reviews"
            value={portfolio.testimonials}
            onChange={(e)=>setPortfolio({...portfolio, testimonials: e.target.value})}
          />
        </Section>

        {/* SECTION: Agreements */}
        <Section title="User Agreements">
          <div className="space-y-2 text-sm text-yellow-300">
            <Check
              label={<>I have read and agree to the <a className="underline" href="/legal#terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a></>}
              checked={agreements.terms}
              onChange={()=>setAgreements({...agreements, terms: !agreements.terms})}
            />
            <Check
              label={<>I have read and agree to the <a className="underline" href="/legal#privacy" target="_blank" rel="noreferrer">Privacy Policy</a></>}
              checked={agreements.privacy}
              onChange={()=>setAgreements({...agreements, privacy: !agreements.privacy})}
            />
          </div>
        </Section>

        {/* SUBMIT */}
        <button
          disabled={!canSubmit || busy}
          className="w-full bg-yellow-400 text-black font-semibold rounded-lg py-2 disabled:opacity-60"
        >
          {busy ? "Submitting..." : "Submit Application"}
        </button>
      </form>
    </div>
  );
}

/* ---------- Small UI bits (black/yellow/grey) ---------- */
function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-yellow-500/40 p-4 bg-black">
      <h3 className="font-semibold mb-3 text-yellow-400">{title}</h3>
      {children}
    </section>
  );
}
function Label({ children }) { return <div className="text-sm text-yellow-300 mb-1">{children}</div>; }
function Input({ label, ...props }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input {...props} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200" />
    </label>
  );
}
function Select({ label, options=[], ...props }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select {...props} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200">
        <option value="">{/* keep blank to force explicit choice when required */}</option>
        {options.map((o)=> <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Check({ label, ...props }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
function UploadButton({ title="Upload", onUploaded, widgetFactory, disabled, folder }) {
  function open() {
    const widget = widgetFactory?.(onUploaded, folder);
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
      className="px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
      title="Upload with Cloudinary"
    >
      {title}
    </button>
  );
}
function UploadRow({ label, value, onChange, widgetFactory, widgetReady, folder }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
          placeholder="Paste image URL"
          value={value}
          onChange={(e)=>onChange(e.target.value)}
        />
        <UploadButton
          title={widgetReady ? "Upload" : "Upload (loading…)"}
          onUploaded={(url)=>onChange(url)}
          widgetFactory={widgetFactory}
          disabled={!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET}
          folder={folder}
        />
      </div>
      {(!CLOUD_NAME || !UPLOAD_PRESET) && (
        <p className="text-xs text-zinc-500 mt-1">Upload widget not configured — the URL field is the fallback.</p>
      )}
    </div>
  );
}
