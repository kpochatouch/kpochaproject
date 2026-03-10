// apps/web/src/pages/Settings.jsx
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ensureClientProfile,
  listBanksNG,
  getPayoutBankMe,
  savePayoutBank,
} from "../lib/api";
import { getSignedMediaUrl } from "../lib/r2Upload";
import { useToast } from "../components/Toast.jsx";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import ServicePicker from "../components/ServicePicker.jsx";
import MediaUploader from "../components/MediaUploader.jsx";
import FaceEnrollModal from "../components/FaceEnrollModal.jsx";

/* ---------- username cooldown (3 months) ---------- */
// Change USERNAME_COOLDOWN_DAYS to 180 if you want 6 months instead
const USERNAME_COOLDOWN_DAYS = 90;
const USERNAME_COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/* ---------- helpers ---------- */
const digitsOnly = (s = "") => String(s).replace(/\D/g, "");
function formatMoneyForInput(s = "") {
  const cleaned = String(s).replace(/,/g, "");
  if (cleaned === "") return "";
  const [whole, frac] = cleaned.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac != null ? `${withCommas}.${frac}` : withCommas;
}
function cleanMoney(v) {
  if (!v) return "";
  return v.toString().replace(/,/g, "").trim();
}

/* ---------- one-shot liveness helper ---------- */
function takeAwsLivenessProof() {
  try {
    const raw = localStorage.getItem("kpocha:livenessMetrics");
    if (!raw) return null;
    localStorage.removeItem("kpocha:livenessMetrics"); // one-time use
    const parsed = JSON.parse(raw);
    return parsed && parsed.ok ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------- drafts for when liveness interrupts ---------- */
function stashSettingsDraft(section, payload) {
  try {
    localStorage.setItem(
      "kpocha:settingsDraft",
      JSON.stringify({ section, payload, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}
function takeSettingsDraft() {
  try {
    const raw = localStorage.getItem("kpocha:settingsDraft");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed || null;
  } catch {
    return null;
  }
}

function isFreshDraft(d, maxAgeMs = 5 * 60 * 1000) {
  const ts = Number(d?.ts || 0);
  return Number.isFinite(ts) && Date.now() - ts <= maxAgeMs;
}

function markFaceEnrollAfterLiveness() {
  try {
    localStorage.setItem("kpocha:openFaceEnrollAfterLiveness", "1");
  } catch {
    /* ignore */
  }
}

function takeFaceEnrollAfterLiveness() {
  try {
    const yes =
      localStorage.getItem("kpocha:openFaceEnrollAfterLiveness") === "1";
    localStorage.removeItem("kpocha:openFaceEnrollAfterLiveness");
    return yes;
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const { success, error, info } = useToast();

  // step-by-step view (like BookingDetails “wrapped”)
  const [step, setStep] = useState("general"); // "general" | "pro" | "payments" | "advanced"

  // main docs
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);
  const [appDoc, setAppDoc] = useState(null);

  // 👇 we keep today’s liveness (if server sent it)
  const [livenessVerifiedAt, setLivenessVerifiedAt] = useState(null);
  // 👇 we show this if we just asked them to verify
  const [showLivenessNotice, setShowLivenessNotice] = useState(false);

  // general/user
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [avatarAssetId, setAvatarAssetId] = useState("");
  const [clientBio, setClientBio] = useState("");
  const [username, setUsername] = useState("");
  const [usernameLastChangedAt, setUsernameLastChangedAt] = useState(null);

  // location
  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");

  // pro toggles
  const [profileVisible, setProfileVisible] = useState(true);
  const [nationwide, setNationwide] = useState(false);
  const [statesCovered, setStatesCovered] = useState([]);

  // professional fields
  const [services, setServices] = useState([]);
  const [years, setYears] = useState("");
  const [hasCert, setHasCert] = useState("no");
  const [certPreviewUrl, setCertPreviewUrl] = useState("");
  const [certAssetId, setCertAssetId] = useState("");

  // pro public
  const [proBio, setProBio] = useState("");
  const [proPhotoPreviewUrl, setProPhotoPreviewUrl] = useState("");
  const [proPhotoAssetId, setProPhotoAssetId] = useState("");

  // gallery
  const [workPhotoPreviewUrls, setWorkPhotoPreviewUrls] = useState([""]);
  const [workPhotoAssetIds, setWorkPhotoAssetIds] = useState([""]);

  // bank
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  // paystack banks (for dropdown)
  const [banks, setBanks] = useState([]); // [{ name, code }]
  const [loadingBanks, setLoadingBanks] = useState(false);
  const banksRef = useRef([]);

  // become-pro stuff we want to keep editable
  const [servicesDetailed, setServicesDetailed] = useState([
    { id: "", name: "", price: "", promoPrice: "", otherText: "" },
  ]);
  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",

    // preview-only
    shopPhotoOutsidePreviewUrl: "",
    shopPhotoInsidePreviewUrl: "",

    // canonical asset ids
    shopPhotoOutsideAssetId: "",
    shopPhotoInsideAssetId: "",

    lat: "",
    lon: "",
  });
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

  // guards
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPro, setSavingPro] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [faceInfo, setFaceInfo] = useState(null);
  const [loadingFace, setLoadingFace] = useState(false);
  const [faceEnrollOpen, setFaceEnrollOpen] = useState(false);
  const [faceEnrollBusy, setFaceEnrollBusy] = useState(false);
  const [faceSelfie, setFaceSelfie] = useState({
    previewUrl: "",
    assetId: "",
  });

  const [lightboxUrl, setLightboxUrl] = useState("");

  // ✅ baseline for "already saved" detection (disable save when no changes)
  const profileBaselineRef = useRef(null);

  function clearMsg() {
    setShowLivenessNotice(false);
  }

  function flashOK(msg) {
    success(msg, { playSound: true, ttl: 2500 });
  }

  function flashErr(msg) {
    error(msg, { playSound: true, ttl: 6000 });
  }

  /* ---------- states list ---------- */
  const [allStates, setAllStates] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!alive) return;
        const states = Array.isArray(data?.states)
          ? data.states.map((s) => s.toString().toUpperCase())
          : [];
        setAllStates(states);
      } catch {
        /* ignore */
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

  function toggleStateCovered(st) {
    const key = st.toUpperCase();
    setStatesCovered((p) =>
      p.includes(key) ? p.filter((x) => x !== key) : [...p, key],
    );
  }

  /* ---------- load data ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      clearMsg();
      setLoading(true);
      try {
        await ensureClientProfile(); // ✅ create client profile if missing
        const [meRes, clientRes, proRes] = await Promise.all([
          api.get("/api/me"),
          api.get("/api/profile/me").catch(() => null),
          api.get("/api/pros/me").catch(() => null),
        ]);
        if (!alive) return;

        const meData = meRes?.data || null;
        const clientData = clientRes?.data || null;
        const proData = proRes?.data || null;

        setMe(meData);
        setClient(clientData);
        setAppDoc(proData);

        const base = clientData || proData || meData || {};

        if (clientData?.livenessVerifiedAt) {
          setLivenessVerifiedAt(clientData.livenessVerifiedAt);
        }

        setDisplayName(
          base.displayName ||
            base.fullName ||
            base?.identity?.fullName ||
            meData?.email ||
            "",
        );
        setPhone(
          clientData?.phone ||
            clientData?.identity?.phone ||
            proData?.phone ||
            proData?.identity?.phone ||
            meData?.identity?.phone ||
            "",
        );

        const st =
          clientData?.state ||
          proData?.state ||
          meData?.state ||
          clientData?.identity?.state ||
          proData?.identity?.state ||
          meData?.identity?.state ||
          "";
        const lg =
          clientData?.lga ||
          proData?.lga ||
          meData?.lga ||
          clientData?.identity?.city ||
          proData?.identity?.city ||
          meData?.identity?.city ||
          "";
        setStateVal(String(st || "").toUpperCase());
        setLga(String(lg || "").toUpperCase());

        setAvatarPreviewUrl("");

        setAvatarAssetId(
          clientData?.photoAssetId ||
            clientData?.identity?.photoAssetId ||
            proData?.photoAssetId ||
            proData?.identity?.photoAssetId ||
            meData?.photoAssetId ||
            meData?.identity?.photoAssetId ||
            "",
        );

        // username + last change time
        const serverUsername =
          clientData?.username ||
          clientData?.identity?.username ||
          meData?.username ||
          "";

        let lastUsernameChange =
          clientData?.usernameLastChangedAt ||
          clientData?.usernameChangedAt ||
          null;

        // fallback to localStorage if backend doesn't send it yet
        if (!lastUsernameChange) {
          try {
            const stored = localStorage.getItem("kpocha:usernameLastChangedAt");
            if (stored) {
              const ts = Number(stored);
              if (Number.isFinite(ts)) {
                lastUsernameChange = new Date(ts).toISOString();
              }
            }
          } catch {
            /* ignore */
          }
        }

        setUsername(serverUsername || "");
        setUsernameLastChangedAt(lastUsernameChange || null);

        // ✅ baseline snapshot (used to disable Save when nothing changed)
        profileBaselineRef.current = {
          displayName:
            base.displayName ||
            base.fullName ||
            base?.identity?.fullName ||
            meData?.email ||
            "",
          phone:
            clientData?.phone ||
            clientData?.identity?.phone ||
            proData?.phone ||
            proData?.identity?.phone ||
            meData?.identity?.phone ||
            "",
          stateVal: String(st || "").toUpperCase(),
          lga: String(lg || "").toUpperCase(),
          avatarAssetId:
            clientData?.photoAssetId ||
            clientData?.identity?.photoAssetId ||
            proData?.photoAssetId ||
            proData?.identity?.photoAssetId ||
            meData?.photoAssetId ||
            meData?.identity?.photoAssetId ||
            "",
          clientBio: clientData?.bio || "",
          username: serverUsername || "",
        };

        setClientBio(clientData?.bio || "");

        if (proData) {
          setProfileVisible(
            Boolean(
              proData?.professional?.profileVisible ??
                proData?.profileVisible ??
                true,
            ),
          );
          setNationwide(Boolean(proData?.professional?.nationwide ?? false));
          setStatesCovered(
            Array.isArray(proData?.availability?.statesCovered)
              ? proData.availability.statesCovered.map((s) =>
                  s.toString().toUpperCase(),
                )
              : [],
          );

          setServices(
            Array.isArray(proData?.professional?.services)
              ? proData.professional.services
              : Array.isArray(proData?.services)
              ? proData.services.map((s) =>
                  typeof s === "string" ? s : s.name,
                )
              : [],
          );
          setYears(proData?.professional?.years || "");
          const hc = String(proData?.professional?.hasCert || "no");
          setHasCert(hc === "yes" ? "yes" : "no");
          setCertPreviewUrl("");
          setCertAssetId(proData?.professional?.certAssetId || "");
          setWorkPhotoPreviewUrls([""]);

          setProBio(proData?.bio || proData?.description || "");

          setProPhotoPreviewUrl("");

          setProPhotoAssetId(proData?.photoAssetId || "");

          if (
            Array.isArray(proData?.servicesDetailed) &&
            proData.servicesDetailed.length
          ) {
            setServicesDetailed(
              proData.servicesDetailed.map((s) => ({
                id: s.id || s.name || "",
                name: s.name || "",
                price: s.price ? formatMoneyForInput(s.price.toString()) : "",
                promoPrice: s.promoPrice
                  ? formatMoneyForInput(s.promoPrice.toString())
                  : "",
                otherText: "",
              })),
            );
          } else if (
            Array.isArray(proData?.services) &&
            proData.services.length
          ) {
            setServicesDetailed(
              proData.services.map((s) => {
                if (typeof s === "string") {
                  return {
                    id: s,
                    name: s,
                    price: "",
                    promoPrice: "",
                    otherText: "",
                  };
                }
                return {
                  id: s.id || s.name || "",
                  name: s.name || "",
                  price: s.price ? formatMoneyForInput(s.price) : "",
                  promoPrice: s.promoPrice
                    ? formatMoneyForInput(s.promoPrice)
                    : "",
                  otherText: "",
                };
              }),
            );
          }

          setBusiness({
            mode: proData?.business?.mode || "shop",
            shopName: proData?.business?.shopName || "",
            shopAddress: proData?.business?.shopAddress || "",

            // preview-only
            shopPhotoOutsidePreviewUrl: "",
            shopPhotoInsidePreviewUrl: "",
            // canonical asset ids
            shopPhotoOutsideAssetId:
              proData?.business?.shopPhotoOutsideAssetId || "",
            shopPhotoInsideAssetId:
              proData?.business?.shopPhotoInsideAssetId || "",

            lat: proData?.business?.lat || proData?.lat || "",
            lon: proData?.business?.lon || proData?.lon || "",
          });

          setWorkPhotoAssetIds(
            Array.isArray(proData?.professional?.workPhotoAssetIds) &&
              proData.professional.workPhotoAssetIds.length
              ? proData.professional.workPhotoAssetIds
              : Array.isArray(proData?.workPhotoAssetIds) &&
                proData.workPhotoAssetIds.length
              ? proData.workPhotoAssetIds
              : [""],
          );

          const av = proData?.availability || {};
          setAvailability({
            days: {
              Mon: av?.days?.Mon || false,
              Tue: av?.days?.Tue || false,
              Wed: av?.days?.Wed || false,
              Thu: av?.days?.Thu || false,
              Fri: av?.days?.Fri || false,
              Sat: av?.days?.Sat || false,
              Sun: av?.days?.Sun || false,
            },
            start: av.start || "",
            end: av.end || "",
            emergency: av.emergency || "no",
            homeService: av.homeService || "no",
            homeServicePrice: av.homeServicePrice
              ? formatMoneyForInput(av.homeServicePrice)
              : "",
            statesCovered: Array.isArray(av.statesCovered)
              ? av.statesCovered
              : [],
          });
        } else {
          setProfileVisible(true);
          setNationwide(false);
          setStatesCovered([]);
          setServices([]);
          setYears("");
          setHasCert("no");
          setCertPreviewUrl("");
          setWorkPhotoPreviewUrls([""]);
          setProBio("");
          setProPhotoPreviewUrl("");
          setCertAssetId("");
          setWorkPhotoAssetIds([""]);
          setProPhotoAssetId("");
          setBusiness({
            mode: "shop",
            shopName: "",
            shopAddress: "",
            shopPhotoOutsidePreviewUrl: "",
            shopPhotoInsidePreviewUrl: "",
            shopPhotoOutsideAssetId: "",
            shopPhotoInsideAssetId: "",
            lat: "",
            lon: "",
          });
          setServicesDetailed([
            { id: "", name: "", price: "", promoPrice: "", otherText: "" },
          ]);
        }

        const nextAvatarAssetId =
          clientData?.photoAssetId ||
          clientData?.identity?.photoAssetId ||
          proData?.photoAssetId ||
          proData?.identity?.photoAssetId ||
          meData?.photoAssetId ||
          meData?.identity?.photoAssetId ||
          "";

        const nextProPhotoAssetId = proData?.photoAssetId || "";
        const nextCertAssetId = proData?.professional?.certAssetId || "";

        const nextShopOutsideAssetId =
          proData?.business?.shopPhotoOutsideAssetId || "";
        const nextShopInsideAssetId =
          proData?.business?.shopPhotoInsideAssetId || "";

        const nextWorkPhotoAssetIds =
          Array.isArray(proData?.professional?.workPhotoAssetIds) &&
          proData.professional.workPhotoAssetIds.length
            ? proData.professional.workPhotoAssetIds
            : Array.isArray(proData?.workPhotoAssetIds) &&
              proData.workPhotoAssetIds.length
            ? proData.workPhotoAssetIds
            : [""];

        // hydrate previews from saved assetIds
        (async () => {
          const [
            avatarUrl,
            proPhotoUrl,
            certUrl,
            shopOutsideUrl,
            shopInsideUrl,
          ] = await Promise.all([
            resolvePreviewUrl(nextAvatarAssetId),
            resolvePreviewUrl(nextProPhotoAssetId),
            resolvePreviewUrl(nextCertAssetId),
            resolvePreviewUrl(nextShopOutsideAssetId),
            resolvePreviewUrl(nextShopInsideAssetId),
          ]);

          if (!alive) return;

          setAvatarPreviewUrl(avatarUrl || "");
          setProPhotoPreviewUrl(proPhotoUrl || "");
          setCertPreviewUrl(certUrl || "");

          setBusiness((prev) => ({
            ...prev,
            shopPhotoOutsidePreviewUrl: shopOutsideUrl || "",
            shopPhotoInsidePreviewUrl: shopInsideUrl || "",
          }));

          const workUrls = await Promise.all(
            nextWorkPhotoAssetIds.map((id) => resolvePreviewUrl(id)),
          );

          if (!alive) return;
          setWorkPhotoPreviewUrls(
            workUrls.length ? workUrls.map((u) => u || "") : [""],
          );
        })();

        // ✅ Load banks list + saved payout bank (best-effort)
        (async () => {
          let items = [];
          try {
            setLoadingBanks(true);
            items = await listBanksNG();
            items = Array.isArray(items) ? items : [];
            setBanks(items);
            banksRef.current = items;
          } catch {
            items = [];
            setBanks([]);
          } finally {
            setLoadingBanks(false);
          }

          try {
            const pay = await getPayoutBankMe();
            const pb = pay?.payoutBank || null;
            if (pb) {
              const code = String(pb.code || "").trim();
              setBankCode(code);
              setAccountNumber(String(pb.accountNumber || ""));
              setAccountName(String(pb.accountName || "")); // verified by server

              // ✅ NOW derive bankName immediately from the loaded bank list
              const bn =
                (items || []).find((b) => String(b.code) === String(code))
                  ?.name || "";
              setBankName(bn);
            }
          } catch {
            // ignore
          }
        })();

        const draft = takeSettingsDraft();

        if (draft && draft.payload && isFreshDraft(draft)) {
          if (draft.section === "profile") {
            setDisplayName(draft.payload.displayName || "");
            setPhone(draft.payload.phone || "");
            setStateVal((draft.payload.state || "").toUpperCase());
            setLga((draft.payload.lga || "").toUpperCase());
            setAvatarPreviewUrl(draft.payload.avatarPreviewUrl || "");
            setAvatarAssetId(draft.payload.avatarAssetId || "");
            setClientBio(draft.payload.bio || "");
          } else if (draft.section === "pro") {
            setProBio(draft.payload.proBio || "");
            setProPhotoPreviewUrl(draft.payload.proPhotoPreviewUrl || "");
            setProfileVisible(
              typeof draft.payload.profileVisible === "boolean"
                ? draft.payload.profileVisible
                : true,
            );
            setNationwide(!!draft.payload.nationwide);
            if (Array.isArray(draft.payload.statesCovered)) {
              setStatesCovered(
                draft.payload.statesCovered.map((x) => x.toUpperCase()),
              );
            }
            if (Array.isArray(draft.payload.servicesDetailed)) {
              setServicesDetailed(draft.payload.servicesDetailed);
            }
            if (draft.payload.business) {
              setBusiness((prev) => ({ ...prev, ...draft.payload.business }));
            }
            if (draft.payload.availability) {
              setAvailability((prev) => ({
                ...prev,
                ...draft.payload.availability,
              }));
            }
          } else if (draft.section === "bank") {
            const code = String(draft.payload.bankCode || "").trim();
            if (code) {
              setBankCode(code);
              const bn =
                (banksRef.current || []).find(
                  (b) => String(b.code) === String(code),
                )?.name ||
                draft.payload.bankName ||
                "";
              setBankName(bn);
            } else {
              setBankName(draft.payload.bankName || "");
            }
            setAccountName(draft.payload.accountName || "");
            setAccountNumber(draft.payload.accountNumber || "");
          }

          // ✅ after re-applying draft, treat it as the new baseline so Save goes faint

          if (draft.section === "profile") {
            profileBaselineRef.current = {
              displayName: draft.payload.displayName || "",
              phone: draft.payload.phone || "",
              stateVal: String(draft.payload.state || "").toUpperCase(),
              lga: String(draft.payload.lga || "").toUpperCase(),
              avatarAssetId: draft.payload.avatarAssetId || "",
              clientBio: draft.payload.bio || "",
              username: username || "",
            };
          }

          localStorage.removeItem("kpocha:settingsDraft");
        } else if (draft) {
          // ✅ stale draft — remove it so it doesn't keep dirtying the form forever
          localStorage.removeItem("kpocha:settingsDraft");
        }
      } catch {
        if (alive) flashErr("Failed to load your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* ---------- flags ---------- */

  // ✅ detect if Profile form has changed since last load/save
  const profileDirty = useMemo(() => {
    const b = profileBaselineRef.current;
    if (!b) return true; // baseline not set yet, allow save
    return (
      (displayName || "") !== (b.displayName || "") ||
      (phone || "") !== (b.phone || "") ||
      (stateVal || "") !== (b.stateVal || "") ||
      (lga || "") !== (b.lga || "") ||
      (avatarAssetId || "") !== (b.avatarAssetId || "") ||
      (clientBio || "") !== (b.clientBio || "") ||
      (username || "") !== (b.username || "")
    );
  }, [displayName, phone, stateVal, lga, avatarAssetId, clientBio, username]);

  const hasPro = !!appDoc?._id;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!hasPro) {
        setFaceInfo(null);
        setLoadingFace(false);
        return;
      }

      setLoadingFace(true);
      try {
        const { data } = await api.get("/api/face/me");
        if (cancelled) return;

        setFaceInfo({
          face: data?.face || null,
          liveness: data?.liveness || null,
          livenessVerifiedAt: data?.livenessVerifiedAt || null,
        });
      } catch {
        if (cancelled) return;
        setFaceInfo(null);
      } finally {
        if (!cancelled) setLoadingFace(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPro, livenessVerifiedAt]);

  useEffect(() => {
    if (!hasPro) return;
    if (!takeFaceEnrollAfterLiveness()) return;

    setStep("payments");
    setFaceEnrollOpen(true);
  }, [hasPro, livenessVerifiedAt]);
  const canSaveProfile = useMemo(
    () => !!displayName && !!phone && !!stateVal && !!lga,
    [displayName, phone, stateVal, lga],
  );

  const canSavePro = useMemo(() => {
    const hasAnyDetailed = servicesDetailed.some(
      (s) => (s.name || "").trim() !== "",
    );
    return (
      hasPro &&
      (services.length > 0 ||
        hasAnyDetailed ||
        years ||
        hasCert === "yes" ||
        workPhotoAssetIds.filter(Boolean).length > 0 ||
        proBio ||
        proPhotoAssetId)
    );
  }, [
    hasPro,
    services,
    servicesDetailed,
    years,
    hasCert,
    workPhotoAssetIds,
    proBio,
    proPhotoAssetId,
  ]);
  const canSaveBank = useMemo(
    () => hasPro && !!bankCode && digitsOnly(accountNumber).length === 10,
    [hasPro, bankCode, accountNumber],
  );

  useEffect(() => {
    const acct = digitsOnly(accountNumber).slice(0, 10);
    const code = String(bankCode || "").trim();

    if (!hasPro) return;

    if (!code || acct.length !== 10) {
      setAccountName("");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get(
          `/api/payout/resolve?accountNumber=${encodeURIComponent(
            acct,
          )}&bankCode=${encodeURIComponent(code)}`,
        );

        if (cancelled) return;
        setAccountName(String(data?.accountName || ""));
      } catch {
        if (cancelled) return;
        setAccountName("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPro, bankCode, accountNumber]);

  const profileUrl = useMemo(() => {
    if (!username) return "";
    const path = `/profile/${username}`;
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  }, [username]);

  const { canEditUsername, nextUsernameChangeAt } = useMemo(() => {
    if (!usernameLastChangedAt) {
      return { canEditUsername: true, nextUsernameChangeAt: null };
    }
    const lastTs = new Date(usernameLastChangedAt).getTime();
    if (!Number.isFinite(lastTs)) {
      return { canEditUsername: true, nextUsernameChangeAt: null };
    }
    const now = Date.now();
    if (now - lastTs >= USERNAME_COOLDOWN_MS) {
      return { canEditUsername: true, nextUsernameChangeAt: null };
    }
    return {
      canEditUsername: false,
      nextUsernameChangeAt: new Date(lastTs + USERNAME_COOLDOWN_MS),
    };
  }, [usernameLastChangedAt]);

  /* ---------- liveness launcher ---------- */
  async function startAwsLivenessFlow() {
    try {
      const { data } = await api.post("/api/aws-liveness/session");
      const sessionId = data?.sessionId || data?.SessionId || data?.sessionID;
      if (sessionId) {
        window.dispatchEvent(
          new CustomEvent("aws-liveness:start", {
            detail: { sessionId, back: "/settings" }, // <— come back here
          }),
        );
      }
      setShowLivenessNotice(true);
    } catch {
      flashErr(
        "Face verification is required before you can save these changes.",
      );
    }
  }

  async function refreshFaceInfoNow() {
    if (!hasPro) {
      setFaceInfo(null);
      return;
    }

    setLoadingFace(true);
    try {
      const { data } = await api.get("/api/face/me");
      setFaceInfo({
        face: data?.face || null,
        liveness: data?.liveness || null,
        livenessVerifiedAt: data?.livenessVerifiedAt || null,
      });
    } catch {
      setFaceInfo(null);
    } finally {
      setLoadingFace(false);
    }
  }

  async function startFaceEnrollFlow() {
    markFaceEnrollAfterLiveness();
    await startAwsLivenessFlow();
  }

  async function completeFaceEnrollment() {
    if (!faceSelfie?.assetId || faceEnrollBusy) return;

    setFaceEnrollBusy(true);
    try {
      await api.post("/api/face/enroll", {
        enrolledAssetId: faceSelfie.assetId,
      });

      setFaceEnrollOpen(false);
      setFaceSelfie({ previewUrl: "", assetId: "" });
      await refreshFaceInfoNow();
      flashOK("Face verification selfie enrolled.");
    } catch (e) {
      const code = e?.response?.data?.error || "";
      const msg = e?.response?.data?.message || "";

      if (code === "liveness_required") {
        markFaceEnrollAfterLiveness();
        await startAwsLivenessFlow();
      } else {
        flashErr(msg || code || "Face enrollment failed.");
      }
    } finally {
      setFaceEnrollBusy(false);
    }
  }

  /* ---------- saves ---------- */

  // general
  const saveProfile = useCallback(async () => {
    if (!canSaveProfile || savingProfile) return;
    clearMsg();
    setSavingProfile(true);
    try {
      const trimmedUsername = (username || "").trim();

      const prevUsername =
        client?.username || client?.identity?.username || me?.username || "";

      const usernameChanged =
        trimmedUsername && trimmedUsername !== prevUsername;

      if (usernameChanged && !canEditUsername) {
        flashErr(
          "You can only change your username once every 3 months. (Adjustable in code to 6 months.)",
        );
        setSavingProfile(false);
        return;
      }

      const payload = {
        displayName,
        fullName: displayName,
        phone,
        state: stateVal.toUpperCase(),
        lga: lga.toUpperCase(),

        // canonical asset-based only
        ...(avatarAssetId ? { photoAssetId: avatarAssetId } : {}),

        bio: clientBio,
      };

      if (trimmedUsername) {
        payload.username = trimmedUsername;
      }

      // attach one-shot liveness remember flag if present
      const livenessProof = takeAwsLivenessProof();
      if (livenessProof) {
        payload.liveness = { remember: true };
      }

      let res;
      if (client) {
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
        if (res?.data?.livenessVerifiedAt) {
          setLivenessVerifiedAt(res.data.livenessVerifiedAt);
        }
      } else {
        res = await api.put("/api/profile/me", payload);
        setClient(res?.data || payload);
        if (res?.data?.livenessVerifiedAt) {
          setLivenessVerifiedAt(res.data.livenessVerifiedAt);
        }
      }

      setMe((prev) => ({
        ...(prev || {}),
        displayName,
        username: trimmedUsername || prev?.username || "",
        identity: {
          ...(prev?.identity || {}),
          phone,
          state: stateVal.toUpperCase(),
          city: lga.toUpperCase(),
          ...(avatarAssetId ? { photoAssetId: avatarAssetId } : {}),
        },
      }));

      if (usernameChanged) {
        const ts = Date.now();
        const iso = new Date(ts).toISOString();
        setUsernameLastChangedAt(iso);
        try {
          localStorage.setItem("kpocha:usernameLastChangedAt", String(ts));
        } catch {
          /* ignore */
        }
      }

      // ✅ update baseline so Save disables until next real change
      profileBaselineRef.current = {
        displayName,
        phone,
        stateVal: stateVal.toUpperCase(),
        lga: lga.toUpperCase(),
        avatarAssetId: avatarAssetId || "",
        clientBio,
        username: trimmedUsername || "",
      };

      flashOK("Profile saved.");
    } catch (e) {
      if (
        e?.response?.status === 403 &&
        e?.response?.data?.error === "liveness_required"
      ) {
        // stash what the user was trying to save
        stashSettingsDraft("profile", {
          displayName,
          phone,
          state: stateVal,
          lga,
          avatarPreviewUrl,
          avatarAssetId,
          bio: clientBio,
        });

        await startAwsLivenessFlow();
      } else {
        flashErr(e?.response?.data?.error || "Failed to save profile.");
      }
    } finally {
      setSavingProfile(false);
    }
  }, [
    canSaveProfile,
    savingProfile,
    displayName,
    phone,
    stateVal,
    lga,
    avatarPreviewUrl,
    avatarAssetId,
    clientBio,
    client,
    me,
    username,
    canEditUsername,
  ]);

  // pro details
  const saveProDetails = useCallback(async () => {
    if (!canSavePro || savingPro) return;
    clearMsg();
    if (!hasPro) {
      flashErr("No professional profile exists yet. Please apply first.");
      return;
    }
    setSavingPro(true);
    try {
      const normalizedDetailed = (servicesDetailed || [])
        .map((s) => {
          const name = (s.name || "").trim();
          if (!name) return null;
          const price = cleanMoney(s.price);
          const promo = cleanMoney(s.promoPrice);
          return {
            id: s.id || name,
            name,
            price: price === "" ? "0" : price,
            ...(promo ? { promoPrice: promo } : {}),
          };
        })
        .filter(Boolean);

      const serviceNames = normalizedDetailed.length
        ? normalizedDetailed.map((s) => s.name)
        : services;

      const payload = {
        professional: {
          ...(appDoc?.professional || {}),
          services: serviceNames,
          years,
          hasCert,

          // canonical asset-based only
          ...(certAssetId ? { certAssetId } : {}),

          profileVisible,
          nationwide,

          // canonical asset-based only
          ...(Array.isArray(workPhotoAssetIds) &&
          workPhotoAssetIds.filter(Boolean).length
            ? { workPhotoAssetIds: workPhotoAssetIds.filter(Boolean) }
            : {}),
        },

        availability: {
          ...(appDoc?.availability || {}),
          statesCovered: nationwide
            ? stateList
            : (availability.statesCovered && availability.statesCovered.length
                ? availability.statesCovered
                : statesCovered
              ).map((x) => x.toUpperCase()),
          days: availability.days,
          start: availability.start,
          end: availability.end,
          emergency: availability.emergency,
          homeService: availability.homeService,
          homeServicePrice: cleanMoney(availability.homeServicePrice),
        },

        bio: proBio,

        // canonical asset-based only
        ...(proPhotoAssetId ? { photoAssetId: proPhotoAssetId } : {}),

        servicesDetailed: normalizedDetailed,

        business: {
          ...(appDoc?.business || {}),
          mode: business.mode,
          shopName: business.shopName,
          shopAddress: business.shopAddress,
          shopPhotoOutsideAssetId: business.shopPhotoOutsideAssetId || "",
          shopPhotoInsideAssetId: business.shopPhotoInsideAssetId || "",
          lat: business.lat,
          lon: business.lon,
        },

        status: appDoc?.status || "submitted",
      };

      // attach one-shot liveness remember flag if present
      const livenessProof = takeAwsLivenessProof();
      if (livenessProof) {
        payload.liveness = { remember: true };
      }

      const { data } = await api.put("/api/pros/me", payload);
      setAppDoc(data?.item || { ...appDoc, ...payload });
      flashOK("Professional details saved.");
    } catch (e) {
      if (
        e?.response?.status === 403 &&
        e?.response?.data?.error === "liveness_required"
      ) {
        // stash current pro section
        stashSettingsDraft("pro", {
          proBio,
          proPhotoPreviewUrl,
          proPhotoAssetId,
          profileVisible,
          nationwide,
          statesCovered,
          servicesDetailed,
          business,
          availability,
        });
        await startAwsLivenessFlow();
      } else {
        flashErr(
          e?.response?.data?.error || "Failed to save professional details.",
        );
      }
    } finally {
      setSavingPro(false);
    }
  }, [
    canSavePro,
    savingPro,
    appDoc,
    servicesDetailed,
    services,
    years,
    hasCert,
    certPreviewUrl,
    certAssetId,
    profileVisible,
    nationwide,
    workPhotoPreviewUrls,
    stateList,
    statesCovered,
    hasPro,
    proBio,
    proPhotoPreviewUrl,
    proPhotoAssetId,
    availability,
    business,
  ]);

  // bank
  const saveBank = useCallback(async () => {
    if (!canSaveBank || savingBank) return;
    clearMsg();
    if (!hasPro) {
      flashErr("No professional profile exists yet. Please apply first.");
      return;
    }
    setSavingBank(true);
    try {
      const payRes = await savePayoutBank({
        accountNumber: digitsOnly(accountNumber).slice(0, 10),
        bankCode: String(bankCode || "").trim(),
      });

      const payoutBank = payRes?.payoutBank || null;
      const finalCode = String(payoutBank?.code || bankCode || "").trim();

      if (payoutBank) {
        setBankCode(finalCode);
        setAccountNumber(String(payoutBank.accountNumber || ""));
        setAccountName(String(payoutBank.accountName || ""));
      }

      // derive bank name from the current banks list
      const bn =
        (banks || []).find((b) => String(b.code) === String(finalCode))?.name ||
        "";
      setBankName(bn);

      flashOK("Payment details saved.");
    } catch (e) {
      const code = e?.response?.data?.error || "";
      const msg = e?.response?.data?.message || "";

      if (code === "liveness_required") {
        stashSettingsDraft("bank", {
          bankCode,
          bankName,
          accountName,
          accountNumber,
        });
        await startAwsLivenessFlow();
      } else if (code === "face_enroll_required") {
        stashSettingsDraft("bank", {
          bankCode,
          bankName,
          accountName,
          accountNumber,
        });
        flashErr(
          msg || "Face enrollment is required before changing payout details.",
        );
        await startFaceEnrollFlow();
      } else if (code === "face_mismatch") {
        flashErr(msg || "Face verification failed. Please retry.");
      } else {
        flashErr(msg || code || "Failed to save payment details.");
      }
    } finally {
      setSavingBank(false);
    }
  }, [
    canSaveBank,
    savingBank,
    hasPro,
    bankCode,
    bankName,
    accountNumber,
    accountName,
    banks,
    startAwsLivenessFlow,
    startFaceEnrollFlow,
  ]);

  async function resolvePreviewUrl(assetId, variant = "original") {
    const id = String(assetId || "").trim();
    if (!id) return "";
    try {
      return await getSignedMediaUrl({ api, assetId: id, variant });
    } catch {
      return "";
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* Header (like BookingDetails) */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-zinc-400">
            Update your profile, professional details, and payout.
          </p>
        </div>
        {me?.isAdmin && (
          <Link
            to="/admin?tab=settings"
            className="px-3 py-1.5 rounded border border-zinc-800 text-sm hover:bg-zinc-900"
            title="Open system settings"
          >
            System Settings →
          </Link>
        )}
      </div>

      {/* Step tabs (one section at a time) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StepTab
          label="General"
          active={step === "general"}
          onClick={() => setStep("general")}
        />
        <StepTab
          label="Professional"
          active={step === "pro"}
          onClick={() => setStep("pro")}
        />
        <StepTab
          label="Payout"
          active={step === "payments"}
          onClick={() => setStep("payments")}
        />
        <StepTab
          label="Advanced"
          active={step === "advanced"}
          onClick={() => setStep("advanced")}
        />
      </div>

      {showLivenessNotice && (
        <div className="mb-4 rounded border border-amber-700 bg-amber-900/30 text-amber-100 px-3 py-2 text-sm">
          Please complete face verification in the popup, then click “Save”
          again.
        </div>
      )}

      {loading ? (
        <div className="text-zinc-400">Loading…</div>
      ) : (
        <div className="space-y-4">
          {!appDoc && (
            <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 text-yellow-200 px-4 py-3">
              You don’t have a professional profile yet.{" "}
              <Link to="/become" className="underline text-gold">
                Apply here
              </Link>
              .
            </div>
          )}
          {/* GENERAL */}
          {step === "general" && (
            <section className="rounded-xl border border-zinc-800 p-4 bg-black/30">
              <h2 className="text-lg font-semibold mb-3">General</h2>

              <div className="mb-3">
                <Label>Profile Photo</Label>
                <MediaUploader
                  api={api}
                  type="image"
                  visibility="public"
                  valueUrl={avatarPreviewUrl}
                  valueAssetId={avatarAssetId}
                  onPreviewClick={() => setLightboxUrl(avatarPreviewUrl)}
                  onChange={({ previewUrl, assetId }) => {
                    setAvatarPreviewUrl(previewUrl || "");
                    setAvatarAssetId(assetId || "");
                  }}
                  label="Upload Photo"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Display Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <Input
                  label="Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Username (profile link)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!canEditUsername || savingProfile}
                  placeholder="e.g. kpochaqueen"
                />
                <ReadOnly
                  label="Username change limit"
                  value={
                    canEditUsername
                      ? "You can change your username now."
                      : nextUsernameChangeAt
                      ? `Next change: ${nextUsernameChangeAt.toLocaleDateString()}`
                      : "Temporarily locked."
                  }
                />
              </div>

              {username && profileUrl && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ReadOnly label="Public profile link" value={profileUrl} />
                </div>
              )}

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ReadOnly label="Email" value={me?.email || ""} />
              </div>

              <div className="mt-3">
                <Label>Short bio / about you</Label>
                <textarea
                  className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 min-h-[80px]"
                  value={clientBio}
                  onChange={(e) => setClientBio(e.target.value)}
                />
              </div>

              <div className="mt-3">
                <Label>State & LGA</Label>
                <NgGeoPicker
                  valueState={stateVal}
                  onChangeState={(st) => {
                    setStateVal(st.toUpperCase());
                    setLga("");
                  }}
                  valueLga={lga}
                  onChangeLga={(lg) => setLga(lg.toUpperCase())}
                  required
                  className="grid grid-cols-1 gap-3"
                />
              </div>

              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSaveProfile || savingProfile || !profileDirty}
                  onClick={saveProfile}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                >
                  {savingProfile ? "Saving…" : "Save Profile"}
                </button>
              </div>
            </section>
          )}
          {/* PROFESSIONAL */}
          {step === "pro" && (
            <section className="rounded-xl border border-zinc-800 p-4 bg-black/30">
              <h2 className="text-lg font-semibold mb-3">
                Professional Profile
              </h2>

              <div className="mb-4">
                <Label>Pro profile picture (public)</Label>
                <MediaUploader
                  api={api}
                  type="image"
                  visibility="public"
                  valueUrl={proPhotoPreviewUrl}
                  valueAssetId={proPhotoAssetId}
                  onPreviewClick={() => setLightboxUrl(proPhotoPreviewUrl)}
                  onChange={({ previewUrl, assetId }) => {
                    setProPhotoPreviewUrl(previewUrl || "");
                    setProPhotoAssetId(assetId || "");
                  }}
                  label="Upload Pro Photo"
                />
              </div>

              <div className="mb-4">
                <Label>Public bio / description</Label>
                <textarea
                  className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 min-h-[90px]"
                  value={proBio}
                  onChange={(e) => setProBio(e.target.value)}
                  disabled={!hasPro}
                />
              </div>

              <div className="flex items-center justify-between mb-2">
                <Label>Profile visibility</Label>
                <label className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={profileVisible}
                    onChange={(e) => setProfileVisible(e.target.checked)}
                    disabled={!hasPro}
                  />
                  Profile visible in search
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Select
                  label="Years of Experience"
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                  options={
                    hasPro
                      ? ["0–1 year", "2–4 years", "5–10 years", "10+ years"]
                      : []
                  }
                  disabled={!hasPro}
                />
                <Select
                  label="Any certification?"
                  value={hasCert}
                  onChange={(e) => setHasCert(e.target.value)}
                  options={hasPro ? ["no", "yes"] : []}
                  disabled={!hasPro}
                />
                {hasCert === "yes" && hasPro && (
                  <div>
                    <Label>Certificate</Label>
                    <MediaUploader
                      api={api}
                      type="image"
                      visibility="private"
                      valueUrl={certPreviewUrl}
                      valueAssetId={certAssetId}
                      onPreviewClick={() => setLightboxUrl(certPreviewUrl)}
                      onChange={({ previewUrl, assetId }) => {
                        setCertPreviewUrl(previewUrl || "");
                        setCertAssetId(assetId || "");
                      }}
                      label="Upload Certificate"
                    />
                  </div>
                )}
              </div>

              {/* Services & Pricing */}
              <div className="mt-6">
                <Label>Services & Pricing</Label>
                <p className="text-xs text-zinc-500 mb-2">
                  Add at least one service. Price/promo optional.
                </p>

                <div className="space-y-3">
                  {servicesDetailed.map((row, i) => {
                    const isOther = row.id === "other";
                    return (
                      <div
                        key={i}
                        className="border border-zinc-800 rounded-lg p-3 bg-black/30"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <Label>Service</Label>
                            <ServicePicker
                              value={row.id || row.name}
                              onChange={(value, meta) => {
                                const next = [...servicesDetailed];
                                const isO = value === "other";
                                next[i] = {
                                  ...next[i],
                                  id: isO ? "other" : meta?.id || value || "",
                                  name: isO ? "" : meta?.name || value || "",
                                };
                                setServicesDetailed(next);
                              }}
                              includeOther={true}
                              otherText={row.otherText}
                              onOtherText={(txt) => {
                                const next = [...servicesDetailed];
                                next[i] = {
                                  ...next[i],
                                  otherText: txt,
                                  name: txt,
                                };
                                setServicesDetailed(next);
                              }}
                              disabled={!hasPro}
                            />
                            {isOther && (
                              <p className="text-[10px] text-zinc-500 mt-1">
                                Type the custom service name above.
                              </p>
                            )}
                          </div>

                          <div>
                            <Label>Price (₦)</Label>
                            <input
                              className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
                              value={row.price}
                              onChange={(e) => {
                                const next = [...servicesDetailed];
                                next[i] = {
                                  ...next[i],
                                  price: formatMoneyForInput(e.target.value),
                                };
                                setServicesDetailed(next);
                              }}
                              disabled={!hasPro}
                              inputMode="decimal"
                              placeholder="e.g. 15,000"
                            />
                          </div>

                          <div className="flex gap-2 items-start">
                            <input
                              className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                              value={row.promoPrice}
                              onChange={(e) => {
                                const next = [...servicesDetailed];
                                next[i] = {
                                  ...next[i],
                                  promoPrice: formatMoneyForInput(
                                    e.target.value,
                                  ),
                                };
                                setServicesDetailed(next);
                              }}
                              disabled={!hasPro}
                              inputMode="decimal"
                              placeholder="Promo price"
                            />
                            {servicesDetailed.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-red-300"
                                onClick={() =>
                                  setServicesDetailed((prev) =>
                                    prev.filter((_, idx) => idx !== i),
                                  )
                                }
                                disabled={!hasPro}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="mt-2 text-xs text-gold underline"
                  onClick={() =>
                    setServicesDetailed((prev) => [
                      ...prev,
                      {
                        id: "",
                        name: "",
                        price: "",
                        promoPrice: "",
                        otherText: "",
                      },
                    ])
                  }
                  disabled={!hasPro}
                >
                  + Add another service
                </button>
              </div>

              {/* Business */}
              <div className="mt-6">
                <Label>Business Information</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  <Select
                    label="Work Mode"
                    value={business.mode}
                    onChange={(e) =>
                      setBusiness({ ...business, mode: e.target.value })
                    }
                    options={["shop", "home", "both"]}
                    disabled={!hasPro}
                  />
                </div>

                {(business.mode === "shop" || business.mode === "both") && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <Input
                        label="Business / Shop Name"
                        value={business.shopName}
                        onChange={(e) =>
                          setBusiness({ ...business, shopName: e.target.value })
                        }
                        disabled={!hasPro}
                      />
                      <Input
                        label="Business Address"
                        value={business.shopAddress}
                        onChange={(e) =>
                          setBusiness({
                            ...business,
                            shopAddress: e.target.value,
                          })
                        }
                        disabled={!hasPro}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div>
                        <Label>Photo (outside)</Label>
                        <MediaUploader
                          api={api}
                          type="image"
                          visibility="public"
                          valueUrl={business.shopPhotoOutsidePreviewUrl}
                          valueAssetId={business.shopPhotoOutsideAssetId}
                          onPreviewClick={() =>
                            setLightboxUrl(business.shopPhotoOutsidePreviewUrl)
                          }
                          onChange={({ previewUrl, assetId }) =>
                            setBusiness((prev) => ({
                              ...prev,
                              shopPhotoOutsidePreviewUrl: previewUrl || "",
                              shopPhotoOutsideAssetId: assetId || "",
                            }))
                          }
                          label="Upload Outside Photo"
                        />
                      </div>

                      <div>
                        <Label>Photo (inside)</Label>
                        <MediaUploader
                          api={api}
                          type="image"
                          visibility="public"
                          valueUrl={business.shopPhotoInsidePreviewUrl}
                          valueAssetId={business.shopPhotoInsideAssetId}
                          onPreviewClick={() =>
                            setLightboxUrl(business.shopPhotoInsidePreviewUrl)
                          }
                          onChange={({ previewUrl, assetId }) =>
                            setBusiness((prev) => ({
                              ...prev,
                              shopPhotoInsidePreviewUrl: previewUrl || "",
                              shopPhotoInsideAssetId: assetId || "",
                            }))
                          }
                          label="Upload Inside Photo"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <Input
                    label="Latitude (optional)"
                    value={business.lat}
                    onChange={(e) =>
                      setBusiness({ ...business, lat: e.target.value })
                    }
                    disabled={!hasPro}
                  />
                  <Input
                    label="Longitude (optional)"
                    value={business.lon}
                    onChange={(e) =>
                      setBusiness({ ...business, lon: e.target.value })
                    }
                    disabled={!hasPro}
                  />
                </div>
              </div>

              {/* Availability */}
              <div className="mt-6">
                <Label>Work Availability</Label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-sm text-zinc-200 mt-2">
                  {Object.keys(availability.days).map((d) => (
                    <label key={d} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={availability.days[d]}
                        onChange={() =>
                          setAvailability((prev) => ({
                            ...prev,
                            days: { ...prev.days, [d]: !prev.days[d] },
                          }))
                        }
                        disabled={!hasPro}
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
                      setAvailability({
                        ...availability,
                        start: e.target.value,
                      })
                    }
                    disabled={!hasPro}
                  />
                  <Input
                    label="End time"
                    type="time"
                    value={availability.end}
                    onChange={(e) =>
                      setAvailability({ ...availability, end: e.target.value })
                    }
                    disabled={!hasPro}
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
                    disabled={!hasPro}
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
                    disabled={!hasPro}
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
                      disabled={!hasPro}
                    />
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={nationwide}
                      onChange={(e) => setNationwide(e.target.checked)}
                      disabled={!hasPro}
                    />
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
                              onChange={() => toggleStateCovered(st)}
                              disabled={!hasPro}
                            />
                            {st}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Work Photos */}
              <div className="mt-6">
                <Label>Work Photos</Label>
                {workPhotoPreviewUrls.map((u, idx) => (
                  <div
                    key={idx}
                    className="mb-3 border border-zinc-800 rounded-lg p-3"
                  >
                    <MediaUploader
                      api={api}
                      type="image"
                      visibility="public"
                      valueUrl={u}
                      valueAssetId={workPhotoAssetIds[idx] || ""}
                      onPreviewClick={() => setLightboxUrl(u)}
                      onChange={({ previewUrl, assetId }) => {
                        const previews = [...workPhotoPreviewUrls];
                        previews[idx] = previewUrl || "";
                        setWorkPhotoPreviewUrls(previews);

                        const ids = [...(workPhotoAssetIds || [])];
                        while (ids.length < previews.length) ids.push("");
                        ids[idx] = assetId || "";
                        setWorkPhotoAssetIds(ids);
                      }}
                      label={`Upload Work Photo ${idx + 1}`}
                    />

                    {idx > 0 && (
                      <button
                        type="button"
                        className="mt-2 text-sm text-red-400"
                        onClick={() => {
                          setWorkPhotoPreviewUrls((prev) =>
                            prev.filter((_, i) => i !== idx),
                          );
                          setWorkPhotoAssetIds((prev) =>
                            (prev || []).filter((_, i) => i !== idx),
                          );
                        }}
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
                  onClick={() => {
                    setWorkPhotoPreviewUrls((prev) => [...prev, ""]);
                    setWorkPhotoAssetIds((prev) => [...(prev || []), ""]);
                  }}
                  disabled={!hasPro}
                >
                  + Add another
                </button>
              </div>

              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSavePro || savingPro}
                  onClick={saveProDetails}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                >
                  {savingPro ? "Saving…" : "Save Professional Details"}
                </button>
              </div>
            </section>
          )}

          {/* PAYMENTS */}
          {step === "payments" && (
            <section className="rounded-xl border border-zinc-800 p-4 bg-black/30">
              <h2 className="text-lg font-semibold mb-3">Payout</h2>
              <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-zinc-200">
                      Face verification
                    </div>
                    <div className="text-xs text-zinc-400 mt-1">
                      {loadingFace
                        ? "Checking face status..."
                        : faceInfo?.face?.enrolledAssetId
                        ? `Enrolled${
                            faceInfo?.face?.enrolledAt
                              ? ` • ${new Date(
                                  faceInfo.face.enrolledAt,
                                ).toLocaleString()}`
                              : ""
                          }`
                        : "Not enrolled yet."}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Required before payout bank changes and protected
                      withdrawals.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={startFaceEnrollFlow}
                    disabled={!hasPro}
                    className="px-4 py-2 rounded-lg border border-yellow-500/50 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
                  >
                    {faceInfo?.face?.enrolledAssetId
                      ? "Re-enroll Face Selfie"
                      : "Enroll Face Selfie"}
                  </button>
                </div>

                <div className="mt-3">
                  <FaceEnrollModal
                    open={faceEnrollOpen}
                    api={api}
                    busy={faceEnrollBusy}
                    selfie={faceSelfie}
                    onChangeSelfie={setFaceSelfie}
                    onContinue={completeFaceEnrollment}
                    onCancel={() => {
                      setFaceEnrollOpen(false);
                      setFaceSelfie({ previewUrl: "", assetId: "" });
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Bank dropdown (Paystack codes) */}
                <label className="block sm:col-span-2">
                  <Label>Bank *</Label>
                  <select
                    value={bankCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setBankCode(code);

                      const bn =
                        (banks || []).find(
                          (b) => String(b.code) === String(code),
                        )?.name || "";
                      setBankName(bn);
                    }}
                    disabled={!hasPro || loadingBanks}
                    className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 disabled:opacity-50"
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
                  label="Account Number"
                  value={accountNumber}
                  onChange={(e) =>
                    setAccountNumber(digitsOnly(e.target.value).slice(0, 10))
                  }
                  required
                  disabled={!hasPro}
                />

                <ReadOnly
                  label="Account Name (verified)"
                  value={accountName || "—"}
                />
              </div>

              <p className="text-xs text-zinc-500 mt-2">
                Account number must be 10 digits.
              </p>

              <div className="flex justify-end mt-4">
                <button
                  disabled={!canSaveBank || savingBank}
                  onClick={saveBank}
                  className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
                >
                  {savingBank ? "Saving…" : "Save Payment Details"}
                </button>
              </div>
            </section>
          )}
          {/* ADVANCED */}
          {step === "advanced" && (
            <div className="space-y-4">
              {me?.isAdmin && (
                <section className="rounded-xl border border-zinc-800 p-4 bg-black/30">
                  <h2 className="text-lg font-semibold mb-3">Admin</h2>
                  <p className="text-sm text-zinc-400">
                    Configure platform rules in{" "}
                    <Link className="underline" to="/admin?tab=settings">
                      System Settings
                    </Link>
                    .
                  </p>
                </section>
              )}

              <section className="rounded-xl border border-zinc-800 p-4 bg-black/30">
                <h2 className="text-lg font-semibold mb-3">Advanced</h2>
                <div className="flex flex-col gap-2">
                  <Link
                    to="/deactivate"
                    className="inline-flex items-center justify-center rounded-lg border border-red-800 text-red-300 px-4 py-2 hover:bg-red-900/20"
                  >
                    Deactivate Account
                  </Link>
                  <div className="text-xs text-zinc-500">
                    This won’t delete your data immediately. You’ll submit a
                    request and our team will review it.
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl("")}
        >
          <img
            src={lightboxUrl}
            alt="Preview"
            className="max-w-full max-h-[90vh] rounded-lg border border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ---------- tiny UI bits ---------- */
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
      <input
        {...props}
        disabled={disabled}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 disabled:opacity-50"
      />
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
      <select
        {...props}
        disabled={disabled}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 disabled:opacity-50"
      >
        <option value="">{required ? "Select…" : "Select (optional)…"}</option>
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

function StepTab({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border ${
        active
          ? "bg-gold text-black border-gold"
          : "bg-zinc-900/30 text-zinc-300 border-zinc-800 hover:bg-zinc-900"
      }`}
    >
      {label}
    </button>
  );
}
