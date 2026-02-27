// apps/web/src/pages/BecomePro.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  ensureClientProfile,
  listBanksNG,
  submitProApplication,
} from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import MediaUploader from "../components/MediaUploader.jsx";
import ServicePicker from "../components/ServicePicker.jsx";

/* ---------- Utils ---------- */
function digitsOnly(s = "") {
  return String(s).replace(/\D/g, "");
}
function parseMoney(input = "") {
  const cleaned = String(input).replace(/,/g, "").trim();
  if (!cleaned) return "0";
  return cleaned;
}
function formatMoneyForInput(s = "") {
  const cleaned = String(s).replace(/,/g, "");
  if (cleaned === "") return "";
  const [whole, frac] = cleaned.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac != null ? `${withCommas}.${frac}` : withCommas;
}
function normName(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w ]+/g, "")
    .trim();
}

/* ======================= BecomePro Page ======================= */
export default function BecomePro() {
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // step-by-step UI (like Settings)
  const [step, setStep] = useState("identity");
  const STEPS = [
    "identity",
    "services",
    "business",
    "availability",
    "verification",
    "payout",
    "portfolio",
    "agreements",
  ];

  function stepIndexOf(s) {
    const i = STEPS.indexOf(s);
    return i >= 0 ? i : 0;
  }

  function goPrev() {
    const i = stepIndexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  }

  function goNext() {
    const i = stepIndexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  }

  const isFirstStep = stepIndexOf(step) === 0;
  const isLastStep = stepIndexOf(step) === STEPS.length - 1;
  function goStep(nextStep) {
    setMsg("");
    setStep(nextStep);
  }

  // identity | services | business | availability | verification | payout | portfolio | agreements

  // payout banks dropdown
  const [banks, setBanks] = useState([]); // [{ name, code }]
  const [loadingBanks, setLoadingBanks] = useState(false);

  // we keep these so we know what user already has
  const [me, setMe] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);

  // ===== Identity
  const [identity, setIdentity] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gender: "",
    dob: "",
    phone: "",
    whatsapp: "",
    email: "",
    state: "",
    lga: "",
    photoAssetId: "",

    // UI-only preview (NOT persisted)
    photoPreviewUrl: "",

    lat: "",
    lon: "",
  });

  // ===== Professional meta
  const [professional, setProfessional] = useState({
    years: "",
    profileVisible: true,
    nationwide: false,
  });

  // ===== Services & pricing
  const [servicesDetailed, setServicesDetailed] = useState([
    { id: "", name: "", price: "", promoPrice: "", otherText: "" },
  ]);

  // ===== Business
  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",

    // store only assetIds (persisted)
    shopPhotoOutsideAssetId: "",
    shopPhotoInsideAssetId: "",

    // UI-only previews (NOT persisted)
    shopPhotoOutsidePreviewUrl: "",
    shopPhotoInsidePreviewUrl: "",

    lat: "",
    lon: "",
  });

  // ===== Availability
  const [availability, setAvailability] = useState({
    days: {
      Mon: false,
      Tue: false,
      Wed: false,
      Thu: false,
      Fri: false,
      Sat: false,
      Sun: false,
    },
    start: "",
    end: "",
    emergency: "no",
    homeService: "no",
    homeServicePrice: "",
    statesCovered: [],
  });

  // ===== Verification
  const [verification, setVerification] = useState({
    faceVerificationVideoUrl: "",
    livenessMetrics: {},
  });

  // ===== Bank
  const [bank, setBank] = useState({
    bankCode: "",
    bankName: "",
    accountName: "",
    accountNumber: "",
  });

  // ===== Portfolio
  const [portfolio, setPortfolio] = useState({
    instagram: "",
    tiktok: "",
    facebook: "",
    website: "",
    testimonials: "",
  });

  const [agreements, setAgreements] = useState({
    terms: false,
    privacy: false,
  });

  // ===== Pull Nigeria states for picker + nationwide logic
  const [allStates, setAllStates] = useState([]);

  useEffect(() => {
    return () => {
      try {
        if (identity.photoPreviewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(identity.photoPreviewUrl);
        }
      } catch {}

      try {
        if (business.shopPhotoOutsidePreviewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(business.shopPhotoOutsidePreviewUrl);
        }
      } catch {}

      try {
        if (business.shopPhotoInsidePreviewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(business.shopPhotoInsidePreviewUrl);
        }
      } catch {}
    };
  }, [
    identity.photoPreviewUrl,
    business.shopPhotoOutsidePreviewUrl,
    business.shopPhotoInsidePreviewUrl,
  ]);

  // ✅ Load me + client + (maybe) existing pro + geo, and PREFILL
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureClientProfile(); // ✅ create client profile if missing
        const [meRes, clientRes, proRes, geoRes] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/profile/me").catch(() => null),
          api.get("/api/pros/me").catch(() => null),
          api.get("/api/geo/ng"),
        ]);

        // ✅ load banks list (best-effort)
        (async () => {
          try {
            setLoadingBanks(true);
            const items = await listBanksNG();
            setBanks(Array.isArray(items) ? items : []);
          } catch {
            setBanks([]);
          } finally {
            setLoadingBanks(false);
          }
        })();

        if (!alive) return;

        const meData = meRes?.data || null;
        const clientData = clientRes?.data || null;
        const proData = proRes?.data || null;
        const states = Array.isArray(geoRes?.data?.states)
          ? geoRes.data.states
          : [];

        setMe(meData);
        setClientProfile(clientData);
        setAllStates(states);

        // PRIORITY for identity: client → pro → me
        const baseEmail =
          clientData?.email ||
          clientData?.identity?.email ||
          proData?.identity?.email ||
          meData?.email ||
          "";
        const basePhone =
          clientData?.phone ||
          clientData?.identity?.phone ||
          proData?.phone ||
          proData?.identity?.phone ||
          meData?.identity?.phone ||
          "";
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
        const basePhoto =
          clientData?.photoUrl ||
          clientData?.identity?.photoUrl ||
          proData?.identity?.photoUrl ||
          meData?.identity?.photoUrl ||
          "";

        const basePhotoAssetId =
          clientData?.photoAssetId ||
          clientData?.identity?.photoAssetId ||
          proData?.identity?.photoAssetId ||
          meData?.identity?.photoAssetId ||
          "";

        // Try to split client full name
        let firstName = "";
        let lastName = "";
        let middleName = "";
        const clientName =
          clientData?.fullName ||
          clientData?.displayName ||
          proData?.displayName ||
          meData?.displayName ||
          "";
        if (clientName) {
          const parts = clientName.trim().split(/\s+/);
          if (parts.length === 1) {
            firstName = parts[0];
          } else if (parts.length === 2) {
            [firstName, lastName] = parts;
          } else if (parts.length > 2) {
            firstName = parts[0];
            lastName = parts[parts.length - 1];
            middleName = parts.slice(1, -1).join(" ");
          }
        }

        setIdentity((prev) => ({
          ...prev,
          firstName: prev.firstName || firstName,
          middleName: prev.middleName || middleName,
          lastName: prev.lastName || lastName,
          email: prev.email || baseEmail,
          phone: prev.phone || basePhone,
          state: prev.state || baseState,
          lga: prev.lga || baseLga,
          photoAssetId: prev.photoAssetId || basePhotoAssetId,
          photoPreviewUrl: prev.photoPreviewUrl || basePhoto,
        }));

        // If user is already pro and has availability states, keep it
        if (proData?.availability?.statesCovered?.length) {
          setAvailability((p) => ({
            ...p,
            statesCovered: proData.availability.statesCovered,
          }));
        }
      } catch {
        // ignore — page can still be filled manually
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const stateList = useMemo(
    () => (allStates || []).slice().sort(),
    [allStates],
  );

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
          const { data } = await api.get(
            `/api/geo/rev?lat=${encodeURIComponent(
              lat,
            )}&lon=${encodeURIComponent(lon)}`,
          );
          const props = data?.features?.[0]?.properties || {};
          const guessedState = String(
            props.state || props.region || "",
          ).toUpperCase();
          const guessedLga = String(
            props.county || props.city || props.district || props.suburb || "",
          ).toUpperCase();
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

  /* ---------- Face verification storage (AWS liveness) ---------- */
  function checkVerificationStorage() {
    try {
      const metricsRaw = localStorage.getItem("kpocha:livenessMetrics");
      const videoUrl = localStorage.getItem("kpocha:livenessVideoUrl") || "";

      const hasMetrics = !!metricsRaw;
      const hasVideo = !!videoUrl;

      if (hasMetrics || hasVideo) {
        setVerification((v) => ({
          ...v,
          livenessMetrics: metricsRaw
            ? JSON.parse(metricsRaw)
            : v.livenessMetrics || {},
          faceVerificationVideoUrl:
            videoUrl || v.faceVerificationVideoUrl || "",
        }));

        // one-time consume
        localStorage.removeItem("kpocha:livenessMetrics");
        localStorage.removeItem("kpocha:livenessVideoUrl");
      }
    } catch {}
  }

  useEffect(() => {
    const onFocus = () => checkVerificationStorage();
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkVerificationStorage();
    };
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
    const isOther = value === "other";
    updateRow(i, {
      id: isOther ? "other" : meta?.id || value || "",
      name: isOther ? "" : meta?.name || value || "",
    });
  }
  function onOtherText(i, txt) {
    updateRow(i, { otherText: txt, name: txt });
  }
  function addRow() {
    setServicesDetailed((r) => [
      ...r,
      { id: "", name: "", price: "", promoPrice: "", otherText: "" },
    ]);
  }
  function removeRow(i) {
    setServicesDetailed((r) => r.filter((_, idx) => idx !== i));
  }

  /* ---------- Validation (per-step) ---------- */
  const missingByStep = useMemo(() => {
    const out = {
      identity: [],
      services: [],
      business: [],
      availability: [],
      verification: [],
      payout: [],
      portfolio: [], // optional (no required fields)
      agreements: [],
    };

    // ---------- identity ----------
    if (!identity.firstName) out.identity.push("First name");
    if (!identity.lastName) out.identity.push("Last name");
    if (!identity.gender) out.identity.push("Gender");
    if (!identity.dob) out.identity.push("Date of birth");
    if (!identity.state) out.identity.push("State");
    if (!professional.nationwide && !identity.lga)
      out.identity.push("LGA (or select Nationwide)");

    // ---------- services ----------
    const resolvedRows = servicesDetailed
      .map((r) => ({ ...r, resolvedName: (r.name || "").trim() }))
      .filter((r) => r.resolvedName);

    if (resolvedRows.length === 0) out.services.push("At least one service");

    const seen = new Set();
    for (const r of resolvedRows) {
      const key = normName(r.resolvedName);
      if (seen.has(key)) {
        out.services.push("Duplicate service names");
        break;
      }
      seen.add(key);
    }

    // ---------- business ----------
    // currently optional (no required items) → leave empty

    // ---------- availability ----------
    // currently optional (no required items) → leave empty

    // ---------- verification ----------
    // optional (AWS liveness) → leave empty

    // ---------- payout ----------
    if (!bank.bankCode) out.payout.push("Bank (select)");
    if (!bank.accountName) out.payout.push("Account name");
    if (!bank.accountNumber) out.payout.push("Account number");

    // ---------- agreements ----------
    if (!agreements.terms) out.agreements.push("Accept Terms");
    if (!agreements.privacy) out.agreements.push("Accept Privacy Policy");

    return out;
  }, [
    identity.firstName,
    identity.lastName,
    identity.gender,
    identity.dob,
    identity.state,
    identity.lga,
    professional.nationwide,
    servicesDetailed,
    bank.bankCode,
    bank.accountName,
    bank.accountNumber,
    agreements.terms,
    agreements.privacy,
  ]);

  const missingAll = useMemo(() => {
    return Object.values(missingByStep).flat();
  }, [missingByStep]);

  const missingCurrent = useMemo(() => {
    return missingByStep?.[step] || [];
  }, [missingByStep, step]);

  const canSubmit = missingAll.length === 0;

  /* ---------- Submit ---------- */
  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) {
      setMsg(`Please complete: ${missingAll.join(", ")}`);
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      const topLat = business.lat || identity.lat || "";
      const topLon = business.lon || identity.lon || "";

      const normalizedRows = servicesDetailed
        .map((r) => {
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
          photoPreviewUrl: undefined, // UI-only: DO NOT STORE
          ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
          // 👇 make sure backend can map this to client later
          email: identity.email || me?.email || "",
          phone:
            identity.phone || clientProfile?.phone || me?.identity?.phone || "",
          state: identity.state,
          city: identity.lga,
        },
        professional: {
          ...professional,
          services: Array.from(new Set(normalizedRows.map((r) => r.name))),
        },
        business: {
          ...business,
          shopPhotoOutsidePreviewUrl: undefined, // UI-only
          shopPhotoInsidePreviewUrl: undefined, // UI-only
          ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
        },
        availability: {
          ...availability,
          statesCovered: professional.nationwide
            ? stateList
            : availability.statesCovered,
        },
        servicesDetailed: normalizedRows,
        ...(verification?.faceVerificationVideoUrl ||
        (verification?.livenessMetrics &&
          Object.keys(verification.livenessMetrics || {}).length > 0)
          ? { verification }
          : {}),

        bank: {
          ...bank,
          accountNumber: digitsOnly(bank.accountNumber).slice(0, 10),
        },
        portfolio,
        status: "submitted",
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: {
          terms: !!agreements.terms,
          privacy: !!agreements.privacy,
        },
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
      <h2 className="text-2xl font-semibold mb-6 text-yellow-400">
        Professional Application
      </h2>
      {msg && <div className="mb-4 text-sm text-red-400">{msg}</div>}

      {/* Step tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <StepTab
          label="Identity"
          active={step === "identity"}
          onClick={() => goStep("identity")}
        />
        <StepTab
          label="Services"
          active={step === "services"}
          onClick={() => goStep("services")}
        />
        <StepTab
          label="Business"
          active={step === "business"}
          onClick={() => goStep("business")}
        />
        <StepTab
          label="Availability"
          active={step === "availability"}
          onClick={() => goStep("availability")}
        />
        <StepTab
          label="Face Verification"
          active={step === "verification"}
          onClick={() => goStep("verification")}
        />

        <StepTab
          label="Payout"
          active={step === "payout"}
          onClick={() => goStep("payout")}
        />
        <StepTab
          label="Portfolio"
          active={step === "portfolio"}
          onClick={() => goStep("portfolio")}
        />
        <StepTab
          label="Agreements"
          active={step === "agreements"}
          onClick={() => goStep("agreements")}
        />
      </div>
      {missingCurrent.length > 0 && (
        <div className="mb-4 border border-yellow-500/50 rounded-lg p-3 bg-black text-yellow-300">
          <div className="text-sm font-semibold mb-1">Missing (this step):</div>

          <p className="text-xs text-zinc-400 mb-2">
            Fields marked with <strong>*</strong> are required. To proceed,
            complete the items listed below.
          </p>

          <ul className="text-sm list-disc pl-5 space-y-1">
            {missingCurrent.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={submit} className="space-y-8">
        {/* SECTION: Identity */}
        {step === "identity" && (
          <Section title="Identity & Contact">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                label="First Name *"
                value={identity.firstName}
                onChange={(e) =>
                  setIdentity({ ...identity, firstName: e.target.value })
                }
              />
              <Input
                label="Middle Name"
                value={identity.middleName}
                onChange={(e) =>
                  setIdentity({ ...identity, middleName: e.target.value })
                }
              />
              <Input
                label="Last Name *"
                value={identity.lastName}
                onChange={(e) =>
                  setIdentity({ ...identity, lastName: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Select
                label="Gender *"
                value={identity.gender}
                onChange={(e) =>
                  setIdentity({ ...identity, gender: e.target.value })
                }
                options={["Male", "Female", "Other"]}
              />
              <Input
                label="Date of Birth *"
                type="date"
                value={identity.dob}
                onChange={(e) =>
                  setIdentity({ ...identity, dob: e.target.value })
                }
              />
              <Input
                label="Email"
                type="email"
                value={identity.email}
                onChange={(e) =>
                  setIdentity({ ...identity, email: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Input
                label="Phone (optional)"
                value={identity.phone}
                onChange={(e) =>
                  setIdentity({ ...identity, phone: e.target.value })
                }
              />
              <Input
                label="WhatsApp (optional)"
                value={identity.whatsapp}
                onChange={(e) =>
                  setIdentity({ ...identity, whatsapp: e.target.value })
                }
              />

              <div>
                <Label>Profile Photo (optional)</Label>

                <MediaUploader
                  api={api}
                  type="image"
                  valueUrl={identity.photoPreviewUrl}
                  valueAssetId={identity.photoAssetId}
                  onChange={({ previewUrl, assetId }) =>
                    setIdentity((prev) => {
                      // cleanup old blob preview
                      try {
                        if (prev.photoPreviewUrl?.startsWith("blob:")) {
                          URL.revokeObjectURL(prev.photoPreviewUrl);
                        }
                      } catch {}

                      return {
                        ...prev,
                        photoAssetId: assetId || "",
                        photoPreviewUrl: previewUrl || "",
                      };
                    })
                  }
                />
              </div>
            </div>

            {/* State/LGA + nationwide */}
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-yellow-300">
                <input
                  type="checkbox"
                  checked={professional.nationwide}
                  onChange={(e) =>
                    setProfessional({
                      ...professional,
                      nationwide: e.target.checked,
                    })
                  }
                />
                Offer services nationwide (Nigeria)
              </label>

              <NgGeoPicker
                valueState={identity.state}
                onChangeState={(st) => {
                  setIdentity({ ...identity, state: st, lga: "" });
                  if (st && !professional.nationwide) {
                    setAvailability((p) => ({
                      ...p,
                      statesCovered: p.statesCovered.includes(st)
                        ? p.statesCovered
                        : [...p.statesCovered, st],
                    }));
                  }
                }}
                valueLga={identity.lga}
                onChangeLga={(lga) => setIdentity({ ...identity, lga })}
                required
                className="grid grid-cols-1 gap-3"
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  label="Latitude (optional)"
                  value={business.lat}
                  onChange={(e) =>
                    setBusiness({ ...business, lat: e.target.value })
                  }
                  placeholder="e.g. 6.5244"
                />
                <Input
                  label="Longitude (optional)"
                  value={business.lon}
                  onChange={(e) =>
                    setBusiness({ ...business, lon: e.target.value })
                  }
                  placeholder="e.g. 3.3792"
                />
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
        )}

        {/* SECTION: Services & Pricing */}
        {step === "services" && (
          <Section title="Services & Pricing">
            <p className="text-xs text-zinc-400 mb-2">
              Add at least one service. Price and Promo Price are optional;
              leaving price blank means ₦0 (free add-on).
            </p>

            <div className="space-y-3">
              {servicesDetailed.map((row, i) => {
                const isOther = row.id === "other";
                return (
                  <div
                    key={i}
                    className="border border-yellow-500/40 rounded-lg p-3 bg-black"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label>Service</Label>
                        <ServicePicker
                          value={row.id || row.name}
                          onChange={(value, meta) =>
                            onPickService(i, value, meta)
                          }
                          includeOther={true}
                          otherText={row.otherText}
                          onOtherText={(txt) => onOtherText(i, txt)}
                        />
                        {isOther && (
                          <p className="text-xs text-zinc-500 mt-1">
                            Please specify the custom service name above.
                          </p>
                        )}
                      </div>

                      <div>
                        <Label>Price (₦) — optional</Label>
                        <input
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                          inputMode="decimal"
                          placeholder="e.g. 15,000"
                          value={row.price}
                          onChange={(e) =>
                            updateRow(i, { price: e.target.value })
                          }
                        />
                        <p className="text-[11px] text-zinc-500 mt-1">
                          You can type numbers with commas for clarity.
                        </p>
                      </div>

                      <div>
                        <Label>Promo Price (₦) — optional</Label>
                        <input
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                          inputMode="decimal"
                          placeholder="e.g. 12,000"
                          value={row.promoPrice}
                          onChange={(e) =>
                            updateRow(i, { promoPrice: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex justify-end mt-2">
                      {servicesDetailed.length > 1 && (
                        <button
                          type="button"
                          className="text-sm text-red-400 hover:text-red-300"
                          onClick={() => removeRow(i)}
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
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10"
              >
                + Add another service
              </button>
            </div>
          </Section>
        )}

        {/* SECTION: Business */}
        {step === "business" && (
          <Section title="Business Information">
            <Select
              label="Work Mode"
              value={business.mode}
              onChange={(e) =>
                setBusiness({ ...business, mode: e.target.value })
              }
              options={["shop", "home", "both"]}
            />

            {(business.mode === "shop" || business.mode === "both") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Input
                  label="Business / Shop Name"
                  value={business.shopName}
                  onChange={(e) =>
                    setBusiness({ ...business, shopName: e.target.value })
                  }
                />
                <Input
                  label="Business Address"
                  value={business.shopAddress}
                  onChange={(e) =>
                    setBusiness({ ...business, shopAddress: e.target.value })
                  }
                />

                <div>
                  <Label>Photo (outside)</Label>

                  <MediaUploader
                    api={api}
                    type="image"
                    valueUrl={business.shopPhotoOutsidePreviewUrl}
                    valueAssetId={business.shopPhotoOutsideAssetId}
                    onChange={({ previewUrl, assetId }) =>
                      setBusiness((prev) => {
                        // cleanup old blob preview
                        try {
                          if (
                            prev.shopPhotoOutsidePreviewUrl?.startsWith("blob:")
                          ) {
                            URL.revokeObjectURL(
                              prev.shopPhotoOutsidePreviewUrl,
                            );
                          }
                        } catch {}

                        return {
                          ...prev,
                          shopPhotoOutsideAssetId: assetId || "",
                          shopPhotoOutsidePreviewUrl: previewUrl || "",
                        };
                      })
                    }
                  />
                </div>

                <div>
                  <Label>Photo (inside)</Label>

                  <MediaUploader
                    api={api}
                    type="image"
                    valueUrl={business.shopPhotoInsidePreviewUrl}
                    valueAssetId={business.shopPhotoInsideAssetId}
                    onChange={({ previewUrl, assetId }) =>
                      setBusiness((prev) => {
                        // cleanup old blob preview
                        try {
                          if (
                            prev.shopPhotoInsidePreviewUrl?.startsWith("blob:")
                          ) {
                            URL.revokeObjectURL(prev.shopPhotoInsidePreviewUrl);
                          }
                        } catch {}

                        return {
                          ...prev,
                          shopPhotoInsideAssetId: assetId || "",
                          shopPhotoInsidePreviewUrl: previewUrl || "",
                        };
                      })
                    }
                  />
                </div>
              </div>
            )}
          </Section>
        )}

        {/* SECTION: Work Availability */}
        {step === "availability" && (
          <Section title="Work Availability">
            <Label>Working Days</Label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-sm text-yellow-300">
              {Object.keys(availability.days).map((d) => (
                <label key={d} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={availability.days[d]}
                    onChange={() =>
                      setAvailability((p) => ({
                        ...p,
                        days: { ...p.days, [d]: !p.days[d] },
                      }))
                    }
                  />
                  {d}
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Input
                label="Start time"
                type="time"
                value={availability.start}
                onChange={(e) =>
                  setAvailability({ ...availability, start: e.target.value })
                }
              />
              <Input
                label="End time"
                type="time"
                value={availability.end}
                onChange={(e) =>
                  setAvailability({ ...availability, end: e.target.value })
                }
              />
              <Select
                label="Emergency service?"
                value={availability.emergency}
                onChange={(e) =>
                  setAvailability({
                    ...availability,
                    emergency: e.target.value,
                  })
                }
                options={["no", "yes"]}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Select
                label="Home service?"
                value={availability.homeService}
                onChange={(e) =>
                  setAvailability({
                    ...availability,
                    homeService: e.target.value,
                  })
                }
                options={["no", "yes"]}
              />
              {availability.homeService === "yes" && (
                <Input
                  label="Home service starting price (₦)"
                  value={availability.homeServicePrice}
                  onChange={(e) =>
                    setAvailability({
                      ...availability,
                      homeServicePrice: formatMoneyForInput(e.target.value),
                    })
                  }
                  placeholder="e.g. 10,000"
                />
              )}
            </div>
          </Section>
        )}

        {/* SECTION: Face Verification (AWS Liveness) */}
        {step === "verification" && (
          <Section title="Face Verification (Optional)">
            <p className="text-xs text-zinc-400 mb-2">
              This is optional for now. No government ID is required.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-emerald-500 text-emerald-200 text-sm hover:bg-emerald-500/10"
                onClick={() => nav("/aws-liveness?back=/become")}
                title="Start face verification and return to this form"
              >
                Start Face verification
              </button>

              {verification.faceVerificationVideoUrl ? (
                <span className="text-xs text-emerald-400">Verified ✓</span>
              ) : (
                <span className="text-xs text-zinc-500">
                  Not completed yet.
                </span>
              )}
            </div>
          </Section>
        )}

        {/* SECTION: Payout */}
        {step === "payout" && (
          <Section title="Payout (Bank) Details">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block md:col-span-3">
                <Label>Bank *</Label>
                <select
                  value={bank.bankCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const bn =
                      (banks || []).find((b) => String(b.code) === String(code))
                        ?.name || "";
                    setBank((prev) => ({
                      ...prev,
                      bankCode: code,
                      bankName: bn,
                    }));
                  }}
                  disabled={loadingBanks}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                >
                  <option value="">
                    {loadingBanks ? "Loading banks..." : "Select bank..."}
                  </option>
                  {(banks || []).map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>

              <Input
                label="Account Name *"
                value={bank.accountName}
                onChange={(e) =>
                  setBank((p) => ({ ...p, accountName: e.target.value }))
                }
              />

              <Input
                label="Account Number *"
                value={bank.accountNumber}
                onChange={(e) =>
                  setBank((p) => ({
                    ...p,
                    accountNumber: digitsOnly(e.target.value).slice(0, 10),
                  }))
                }
                placeholder="10 digits"
              />
            </div>

            <p className="text-[11px] text-zinc-500 mt-2">
              Account number must be 10 digits.
            </p>
          </Section>
        )}
        {/* SECTION: Social / Portfolio */}
        {step === "portfolio" && (
          <Section title="Social / Portfolio (optional)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                label="Instagram"
                value={portfolio.instagram}
                onChange={(e) =>
                  setPortfolio({ ...portfolio, instagram: e.target.value })
                }
              />
              <Input
                label="TikTok"
                value={portfolio.tiktok}
                onChange={(e) =>
                  setPortfolio({ ...portfolio, tiktok: e.target.value })
                }
              />
              <Input
                label="Facebook"
                value={portfolio.facebook}
                onChange={(e) =>
                  setPortfolio({ ...portfolio, facebook: e.target.value })
                }
              />
              <Input
                label="Website / Portfolio"
                value={portfolio.website}
                onChange={(e) =>
                  setPortfolio({ ...portfolio, website: e.target.value })
                }
              />
            </div>
            <textarea
              className="w-full mt-3 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
              placeholder="Testimonials / Reviews"
              value={portfolio.testimonials}
              onChange={(e) =>
                setPortfolio({ ...portfolio, testimonials: e.target.value })
              }
            />
          </Section>
        )}

        {/* SECTION: Agreements */}
        {step === "agreements" && (
          <Section title="User Agreements">
            <div className="space-y-2 text-sm text-yellow-300">
              <Check
                label={
                  <>
                    I have read and agree to the{" "}
                    <a
                      className="underline"
                      href="/legal#terms"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Terms &amp; Conditions
                    </a>
                  </>
                }
                checked={agreements.terms}
                onChange={() =>
                  setAgreements({ ...agreements, terms: !agreements.terms })
                }
              />
              <Check
                label={
                  <>
                    I have read and agree to the{" "}
                    <a
                      className="underline"
                      href="/legal#privacy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Privacy Policy
                    </a>
                  </>
                }
                checked={agreements.privacy}
                onChange={() =>
                  setAgreements({ ...agreements, privacy: !agreements.privacy })
                }
              />
            </div>
          </Section>
        )}

        {/* NAVIGATION */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={busy || isFirstStep}
            className="px-4 py-2 rounded-lg border border-yellow-500/50 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
          >
            ← Prev
          </button>

          {!isLastStep ? (
            <button
              type="button"
              onClick={() => {
                if (missingCurrent.length > 0) {
                  setMsg(`Please complete: ${missingCurrent.join(", ")}`);
                  return;
                }
                goNext();
              }}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold text-sm disabled:opacity-60"
            >
              Next →
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold text-sm disabled:opacity-60"
            >
              {busy ? "Submitting..." : "Submit Application"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ---------- Small UI bits ---------- */
function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-yellow-500/40 p-4 bg-black">
      <h3 className="font-semibold mb-3 text-yellow-400">{title}</h3>
      {children}
    </section>
  );
}
function Label({ children }) {
  return <div className="text-sm text-yellow-300 mb-1">{children}</div>;
}
function Input({ label, ...props }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        {...props}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
      />
    </label>
  );
}
function Select({ label, options = [], ...props }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select
        {...props}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
      >
        <option value=""></option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
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

function StepTab({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border ${
        active
          ? "bg-yellow-400 text-black border-yellow-400"
          : "bg-black text-yellow-300 border-yellow-500/40 hover:bg-yellow-500/10"
      }`}
    >
      {label}
    </button>
  );
}
