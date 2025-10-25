// apps/web/src/pages/SettingsPage.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { api, getMe } from "../lib/api"; // ✅ uses cached getMe()
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import SmartUpload from "../components/SmartUpload.jsx";

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

// unified dark field styling
const FIELD =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 placeholder-zinc-500 px-3 py-2 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [appDoc, setAppDoc] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // General / identity
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  // Location
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

  // Payments
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

  /* ---------- Pull states list ---------- */
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
    return () => {
      alive = false;
    };
  }, []);
  const stateList = useMemo(() => (allStates || []).slice().sort(), [allStates]);

  function toggleStateCovered(st) {
    setStatesCovered((p) =>
      p.includes(st) ? p.filter((x) => x !== st) : [...p, st]
    );
  }
  function toggleService(name) {
    setServices((p) =>
      p.includes(name) ? p.filter((s) => s !== name) : [...p, name]
    );
  }

  /* ---------- Load me + appDoc ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      clearMsg();
      setLoading(true);
      try {
        // ✅ use cached getMe() instead of api.get("/api/me")
        const [meData, proRes] = await Promise.all([
          getMe(),
          api.get("/api/pros/me").catch(() => ({ data: null })),
        ]);
        if (!alive) return;

        const app = proRes?.data || null;
        setMe(meData);
        setAppDoc(app);

        setDisplayName(
          meData?.displayName || app?.displayName || meData?.email || ""
        );
        setPhone(
          meData?.identity?.phone ||
            app?.phone ||
            app?.identity?.phone ||
            ""
        );
        setAvatarUrl(
          meData?.identity?.photoUrl || app?.identity?.photoUrl || ""
        );

        const lgaUpper = (
          meData?.identity?.city ||
          app?.lga ||
          app?.identity?.city ||
          ""
        )
          .toString()
          .toUpperCase();
        const stateUpper = (
          meData?.identity?.state ||
          app?.identity?.state ||
          ""
        )
          .toString()
          .toUpperCase();
        setLga(lgaUpper);
        setStateVal(stateUpper);

        setProfileVisible(Boolean(app?.professional?.profileVisible ?? true));
        setNationwide(Boolean(app?.professional?.nationwide ?? false));
        setStatesCovered(
          Array.isArray(app?.availability?.statesCovered)
            ? app.availability.statesCovered
            : []
        );
        setServices(
          Array.isArray(app?.professional?.services)
            ? app.professional.services
            : []
        );
        setYears(app?.professional?.years || "");
        const hc = String(app?.professional?.hasCert || "no");
        setHasCert(hc === "yes" ? "yes" : "no");
        setCertUrl(app?.professional?.certUrl || "");
        setWorkPhotos(
          Array.isArray(app?.professional?.workPhotos) &&
            app.professional.workPhotos.length
            ? app.professional.workPhotos
            : [""]
        );

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
  const hasPro = !!appDoc?._id;
  const canSaveProfile = useMemo(
    () => !!displayName && !!phone && (!!lga || !!stateVal),
    [displayName, phone, lga, stateVal]
  );
  const canSavePro = useMemo(
    () =>
      hasPro &&
      (services.length > 0 ||
        years ||
        hasCert === "yes" ||
        workPhotos.filter(Boolean).length > 0),
    [hasPro, services, years, hasCert, workPhotos]
  );
  const canSaveBank = useMemo(
    () =>
      hasPro &&
      !!bankName &&
      !!accountName &&
      digitsOnly(accountNumber).length === 10 &&
      digitsOnly(bvn).length >= 10,
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

      let res;
      try {
        res = await api.put("/api/profile/me", payload);
      } catch {
        res = await api.put("/api/profile", payload);
      }

      const updated = res?.data?.user || payload;
      setMe((prev) => ({
        ...(prev || {}),
        ...updated,
        identity: {
          ...(prev?.identity || {}),
          ...(updated.identity || payload.identity),
        },
      }));
      flashOK("Profile saved.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save profile.");
    }
  }

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

  /* ---------- UI (unchanged) ---------- */
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Settings</h1>
          <p className="text-zinc-400">
            Manage your profile and professional details.
          </p>
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

      {err && (
        <div className="mt-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="mt-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">
          {ok}
        </div>
      )}

      {/* ... keep all the remaining JSX exactly as in your original version ... */}
      {/* No further logic changes needed below this point */}
    </div>
  );
}

/* ---------- UI bits (unchanged) ---------- */
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
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <input {...props} disabled={disabled} className={FIELD} />
    </label>
  );
}
function Select({ label, options = [], required, disabled, ...props }) {
  return (
    <label className="block">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <select {...props} disabled={disabled} className={FIELD}>
        <option value="">
          {required ? "Select…" : "Select (optional)…"}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
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
        <img
          src={src}
          alt="Preview"
          className="block max-h-[85vh] object-contain"
        />
      </div>
    </div>
  );
}
