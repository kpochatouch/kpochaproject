// apps/web/src/pages/Browse.jsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import BarberCard from "../components/BarberCard";
import ServicePicker from "../components/ServicePicker";
import ProDrawer from "../components/ProDrawer";
import FeedCard from "../components/FeedCard";
import ErrorBoundary from "../components/ErrorBoundary";
import SideMenu from "../components/SideMenu.jsx";

/* ---------------- Feed composer (slimmer) ---------------- */
function FeedComposer({ lga, onPosted }) {
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    try {
      setUploading(true);
      const signRes = await api.post("/api/uploads/sign", {
        folder: "kpocha-feed",
        overwrite: true,
      });
      const {
        cloudName,
        apiKey,
        timestamp,
        signature,
        folder,
        public_id,
        overwrite,
        tags,
      } = signRes.data || {};
      if (!cloudName || !apiKey || !timestamp || !signature) {
        throw new Error("Upload signing failed");
      }

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", apiKey);
      form.append("timestamp", timestamp);
      form.append("folder", folder);
      form.append("signature", signature);
      if (public_id) form.append("public_id", public_id);
      if (typeof overwrite !== "undefined")
        form.append("overwrite", String(overwrite));
      if (tags) form.append("tags", tags);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        { method: "POST", body: form }
      );
      if (!uploadRes.ok) throw new Error("Cloudinary upload failed");
      const uploaded = await uploadRes.json();

      setMediaUrl(uploaded.secure_url || uploaded.url || "");
      setMediaType(file.type.startsWith("video/") ? "video" : "image");
      setMsg("Media uploaded ✔");
    } catch (err) {
      console.error("upload error:", err);
      setMsg("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    setMsg("");
    if (!text.trim() && !mediaUrl.trim()) {
      setMsg("Add some text or upload a photo/video.");
      return;
    }
    try {
      setPosting(true);
      await api.post("/api/posts", {
        text: text.trim(),
        media: mediaUrl ? [{ url: mediaUrl.trim(), type: mediaType }] : [],
        lga: (lga || "").toUpperCase(),
        isPublic: true,
        tags: [],
      });
      setText("");
      setMediaUrl("");
      setMsg("Posted!");
      onPosted?.();
    } catch (e) {
      setMsg(e?.response?.data?.error || "Post failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mb-4 p-3 rounded-xl border border-zinc-800 bg-black/30 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-white text-sm">Share an update</h3>
        {msg ? <span className="text-[10px] text-zinc-400">{msg}</span> : null}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What are you working on today?"
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 mb-2 outline-none focus:border-gold text-sm min-h-[60px]"
      />

      {mediaUrl ? (
        <div className="mb-2">
          <p className="text-[10px] text-zinc-400 mb-1">Preview:</p>
          {mediaType === "video" ? (
            <video
              src={mediaUrl}
              controls
              className="w-full max-h-52 rounded-lg border border-zinc-800 object-cover max-w-full"
            />
          ) : (
            <img
              src={mediaUrl}
              alt="uploaded"
              className="w-full max-h-52 rounded-lg border border-zinc-800 object-cover max-w-full"
            />
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
            className="bg-black border border-zinc-800 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <button
          onClick={submit}
          disabled={posting || uploading}
          className="rounded-lg bg-gold text-black px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Main Browse page ---------------- */
export default function Browse() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, isAdmin, isPro } = useMe();

  const [tab, setTab] = useState("feed");

  const [pros, setPros] = useState([]);
  const [loadingPros, setLoadingPros] = useState(false);
  const [errPros, setErrPros] = useState("");

  const [q, setQ] = useState("");
  const [service, setService] = useState("");
  const [stateName, setStateName] = useState("");
  const [lga, setLga] = useState("");

  const [states, setStates] = useState([]);
  const [lgasByState, setLgasByState] = useState({});

  const [openPro, setOpenPro] = useState(null);

  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [errFeed, setErrFeed] = useState("");

  // right-rail advert
  const [adminAdUrl, setAdminAdUrl] = useState("");
  const [adMsg, setAdMsg] = useState("");

  const didPrefillFromProfileRef = useRef(false);

  // prefill state/LGA from profile once
  useEffect(() => {
    let alive = true;
    if (didPrefillFromProfileRef.current) return;
    (async () => {
      try {
        const profileRes = await api
          .get("/api/profile/me")
          .catch(() => ({ data: null }));
        if (!alive) return;
        const prof = profileRes?.data || null;
        const st = (prof?.identity?.state || prof?.state || "")
          .toString()
          .toUpperCase();
        const lg = (prof?.identity?.city || prof?.lga || "")
          .toString()
          .toUpperCase();
        if (st) setStateName(st);
        if (lg) setLga(lg);
        didPrefillFromProfileRef.current = true;
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // load geo
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!on) return;
        setStates(data?.states || []);
        setLgasByState(data?.lgas || {});
      } catch {
        if (!on) return;
        setStates(["EDO"]);
        setLgasByState({ EDO: ["OREDO", "IKPOBA-OKHA", "EGOR", "OTHERS"] });
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  // fetch pros ONLY when tab = 'pros'
  useEffect(() => {
    if (tab !== "pros") return;
    let on = true;
    setLoadingPros(true);
    setErrPros("");
    (async () => {
      try {
        const params = {};
        if (lga) params.lga = lga.toUpperCase();
        if (stateName) params.state = stateName.toUpperCase();
        const { data } = await api.get("/api/barbers", { params });
        if (!on) return;
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : [];
        setPros(list);
      } catch {
        if (!on) return;
        setErrPros("Failed to load professionals.");
      } finally {
        if (on) setLoadingPros(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [tab, lga, stateName]);

  function svcArray(p) {
    const raw = p?.services;
    if (Array.isArray(raw))
      return raw
        .map((s) => (typeof s === "string" ? s : s?.name))
        .filter(Boolean)
        .map((s) => s.toLowerCase());
    if (typeof raw === "string")
      return raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return [];
  }

  const filteredAndRanked = useMemo(() => {
    const term = q.trim().toLowerCase();
    const selectedState = (stateName || "").toUpperCase();
    const selectedLga = (lga || "").toUpperCase();

    return [...pros]
      .map((p) => {
        const name = String(p?.name || "").toLowerCase();
        const desc = String(p?.bio || p?.description || "").toLowerCase();
        const proState = String(p?.state || p?.identity?.state || "")
          .trim()
          .toUpperCase();
        const proLga = String(p?.lga || p?.identity?.city || "")
          .trim()
          .toUpperCase();
        const servicesLC = svcArray(p);

        const matchName = term ? name.includes(term) || desc.includes(term) : true;
        const matchSvc = service ? servicesLC.includes(service.toLowerCase()) : true;
        const matchState = selectedState ? proState === selectedState : true;
        const matchLga = selectedLga ? proLga === selectedLga : true;

        let score = 0;
        if (service && matchSvc) score += 3;
        if (selectedLga && matchLga) score += 2;
        if (selectedState && matchState) score += 2;
        if (term && matchName) score += 1;

        return { p, ok: matchName && matchSvc && matchState && matchLga, score };
      })
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [pros, q, service, lga, stateName]);

  const lgasForState = useMemo(() => {
    const key = (stateName || "").toUpperCase();
    return key && lgasByState[key] ? lgasByState[key] : [];
  }, [stateName, lgasByState]);

  function clearFilters() {
    setQ("");
    setService("");
    setStateName("");
    setLga("");
  }

  // feed fetch
  const fetchFeed = useCallback(async () => {
    try {
      setLoadingFeed(true);
      setErrFeed("");
      const params = {};
      if (lga) params.lga = lga.toUpperCase();
      const r = await api
        .get("/api/feed/public", { params })
        .catch(() => ({ data: [] }));
      const list = Array.isArray(r.data)
        ? r.data
        : Array.isArray(r.data?.items)
        ? r.data.items
        : [];
      setFeed(list);
    } catch {
      setErrFeed("Could not load feed.");
    } finally {
      setLoadingFeed(false);
    }
  }, [lga]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed, tab]);

  // force feed tab if ?post= is present
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get("post")) setTab("feed");
  }, [location.search]);

  function goBook(pro, chosenService) {
    const svcName = chosenService || service || null;
    const svcList = Array.isArray(pro?.services)
      ? pro.services.map((s) => (typeof s === "string" ? { name: s } : s))
      : [];
    const svcPrice = svcName
      ? svcList.find((s) => s.name === svcName)?.price
      : undefined;

    const proId = pro?.id || pro?._id;
    if (!proId) return;

    navigate(`/book/${proId}?service=${encodeURIComponent(svcName || "")}`, {
      state: {
        proId,
        serviceName: svcName || undefined,
        amountNaira: typeof svcPrice !== "undefined" ? svcPrice : undefined,
        country: "Nigeria",
        state: (stateName || "").toUpperCase(),
        lga: (lga || "").toUpperCase(),
      },
    });
  }

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("authToken") ||
        localStorage.getItem("token")
      : null;
  const canPostOnFeed = !!token;

  return (
    <ErrorBoundary>
      {/* added overflow-x-hidden to avoid small horizontal scroll/extra space on mobile zoom */}
      <div className="max-w-6xl mx-auto px-4 py-10 overflow-x-hidden">
        {/* header + tabs */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <img
              src="/discovery.png"
              alt="Discover"
              className="w-6 h-6 object-contain max-w-full"
            />
            <h1 className="text-2xl font-semibold">Discover</h1>
          </div>
          <div className="inline-flex rounded-xl border border-zinc-800 overflow-hidden">
            <button
              className={`px-4 py-2 text-sm border-r border-zinc-800 ${
                tab === "feed"
                  ? "bg-gold text-black font-semibold"
                  : "hover:bg-zinc-900"
              }`}
              onClick={() => setTab("feed")}
            >
              Feed
            </button>
            <button
              className={`px-4 py-2 text-sm ${
                tab === "pros"
                  ? "bg-gold text-black font-semibold"
                  : "hover:bg-zinc-900"
              }`}
              onClick={() => setTab("pros")}
            >
              Pros
            </button>
          </div>
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or description…"
            className="bg-black border border-zinc-800 rounded-lg px-3 py-2 w-56 max-w-full"
          />
          <div className="w-56 max-w-full">
            <ServicePicker
              value={service}
              onChange={setService}
              placeholder="All services"
              allowCustom={false}
            />
          </div>
          <select
            value={stateName}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setStateName(val);
              setLga("");
            }}
            className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
          >
            <option value="">All States</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={lga}
            onChange={(e) => setLga(e.target.value.toUpperCase())}
            className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
            disabled={stateName && !lgasForState.length}
          >
            <option value="">All LGAs</option>
            {(stateName ? lgasForState : []).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button
            onClick={clearFilters}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
          >
            Clear
          </button>
        </div>

        {/* content */}
        {tab === "pros" ? (
          <>
            {errPros && (
              <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
                {errPros}
              </div>
            )}
            {loadingPros ? (
              <p className="text-zinc-400">Loading…</p>
            ) : filteredAndRanked.length ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAndRanked.map((pro) => (
                  <BarberCard
                    key={pro.id || pro._id}
                    barber={pro}
                    onOpen={setOpenPro}
                    onBook={(svc) => goBook(pro, svc)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-zinc-400">
                No professionals match your filters.
              </div>
            )}
          </>
        ) : (
          // make layout stack on small screens to avoid horizontal overflow when zooming
          <div className="flex flex-col lg:flex-row gap-4">
            {/* LEFT MENU - now actual component (mobile handled inside) */}
            <div className="lg:w-56 w-full pt-1 flex-shrink-0 min-w-0">
              <SideMenu me={me} />
            </div>

            {/* FEED */}
            <div className="flex-1 w-full max-w-2xl lg:mx-0 mx-auto">
              {canPostOnFeed && <FeedComposer lga={lga} onPosted={fetchFeed} />}
              {errFeed && (
                <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
                  {errFeed}
                </div>
              )}
              {loadingFeed ? (
                <p className="text-zinc-400">Loading feed…</p>
              ) : feed.length ? (
                <div className="space-y-4">
                  {feed.slice(0, 8).map((post) => (
                    <FeedCard
                      key={post._id || post.id}
                      post={post}
                      currentUser={me ? { uid: me.uid || me.id, ...me } : null}
                      onDeleted={fetchFeed}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
                  No updates yet.
                </div>
              )}
            </div>

            {/* RIGHT ADS (narrower) */}
            <div className="hidden lg:block w-56 pt-1 flex-shrink-0 min-w-0">
              <div className="sticky top-20 space-y-4">
                {isAdmin ? (
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 space-y-2">
                    <div className="text-xs text-zinc-300 mb-1">Advert (admin only)</div>
                    <input
                      value={adminAdUrl}
                      onChange={(e) => {
                        setAdminAdUrl(e.target.value);
                        setAdMsg("");
                      }}
                      placeholder="Image / video URL"
                      className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs"
                    />
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const localUrl = URL.createObjectURL(file);
                        setAdminAdUrl(localUrl);
                        setAdMsg("Local preview (not uploaded to backend)");
                      }}
                      className="w-full text-[10px] text-zinc-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (!adminAdUrl.trim()) return setAdMsg("Paste a media URL first.");
                          setAdMsg("Previewing…");
                          setTimeout(() => setAdMsg("Preview ready"), 300);
                        }}
                        className="flex-1 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
                      >
                        Preview
                      </button>
                      <button
                        onClick={async () => {
                          if (!adminAdUrl.trim()) return setAdMsg("Paste a media URL first.");
                          try {
                            setAdMsg("Publishing…");
                            await api.post("/api/posts", {
                              text: "Sponsored",
                              media: [
                                {
                                  url: adminAdUrl.trim(),
                                  type: /\.(mp4|mov|webm)$/i.test(adminAdUrl)
                                    ? "video"
                                    : "image",
                                },
                              ],
                              isPublic: true,
                              tags: ["AD"],
                            });
                            setAdMsg("Published to feed ✔");
                            await fetchFeed();
                          } catch (e) {
                            setAdMsg(e?.response?.data?.error || "Failed to publish ad");
                          }
                        }}
                        className="flex-1 rounded-md bg-gold text-black px-2 py-1 text-xs font-semibold"
                      >
                        Publish
                      </button>
                    </div>
                    {adMsg && <p className="text-[10px] text-zinc-500 mt-1">{adMsg}</p>}
                  </div>
                ) : null}

                {adminAdUrl ? (
                  <div className="rounded-lg border border-zinc-800 overflow-hidden bg-black/40 h-40 flex items-center justify-center">
                    {adminAdUrl.match(/\.(mp4|mov|webm)$/i) ? (
                      <video
                        src={adminAdUrl}
                        muted
                        loop
                        playsInline
                        autoPlay
                        className="w-full h-full object-cover max-w-full"
                      />
                    ) : (
                      <img src={adminAdUrl} alt="ad" className="w-full h-full object-cover max-w-full" />
                    )}
                  </div>
                ) : (
                  <div className="h-40 rounded-lg border border-zinc-800 bg-black/20 flex items-center justify-center text-xs text-zinc-500">
                    Advert space
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <ProDrawer
          open={!!openPro}
          pro={openPro}
          onClose={() => setOpenPro(null)}
          onBook={(svc) => (openPro ? goBook(openPro, svc) : null)}
        />
      </div>
    </ErrorBoundary>
  );
}
