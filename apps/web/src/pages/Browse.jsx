// apps/web/src/pages/Browse.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import BarberCard from "../components/BarberCard";
import ServicePicker from "../components/ServicePicker";
import ProDrawer from "../components/ProDrawer";
import FeedCard from "../components/FeedCard";
import ErrorBoundary from "../components/ErrorBoundary"; // ✅ wrap page

/** Pro-only composer (simple: text + media URL) */
function FeedComposer({ lga, onPosted }) {
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image"); // image | video
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    if (!text.trim() && !mediaUrl.trim()) {
      setMsg("Add some text or a media URL.");
      return;
    }
    try {
      setPosting(true);
      const body = {
        text: text.trim(),
        media: mediaUrl ? [{ url: mediaUrl.trim(), type: mediaType }] : [],
        lga: (lga || "").toUpperCase(),
        isPublic: true,
        tags: [],
      };
      await api.post("/api/posts", body);
      setText("");
      setMediaUrl("");
      setMsg("Posted!");
      onPosted?.(); // refresh feed after posting
    } catch (e) {
      setMsg(e?.response?.data?.error || "Post failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mb-6 p-4 rounded-xl border border-zinc-800">
      <h3 className="font-semibold mb-2">Share an update</h3>
      {msg ? <div className="text-xs mb-2 text-zinc-400">{msg}</div> : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What are you working on today?"
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 mb-2"
        rows={3}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="Image/Video URL (optional)"
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
        <select
          value={mediaType}
          onChange={(e) => setMediaType(e.target.value)}
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
        <button
          onClick={submit}
          disabled={posting}
          className="rounded-lg bg-gold text-black px-3 py-2 font-semibold disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        Tip: paste a direct media URL (e.g., Cloudinary/S3). Upload UI can come later.
      </p>
    </div>
  );
}

export default function Browse() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("pros"); // "pros" | "feed"

  // pros directory
  const [pros, setPros] = useState([]);
  const [loadingPros, setLoadingPros] = useState(true);
  const [errPros, setErrPros] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [service, setService] = useState("");
  const [stateName, setStateName] = useState("");
  const [lga, setLga] = useState("");

  // geo
  const [states, setStates] = useState([]);
  const [lgasByState, setLgasByState] = useState({});

  // me
  const [me, setMe] = useState(null);
  const isPro = !!me?.isPro;

  // drawer
  const [openPro, setOpenPro] = useState(null);

  // feed
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [errFeed, setErrFeed] = useState("");

  // load me
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        if (!on) return;
        setMe(data || null);
      } catch {
        if (!on) return;
        setMe(null);
      }
    })();
    return () => {
      on = false;
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
        setStates(["Edo"]);
        setLgasByState({ Edo: ["OREDO", "IKPOBA-OKHA", "EGOR", "OTHERS"] });
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  // load pros
  useEffect(() => {
    let on = true;
    setLoadingPros(true);
    setErrPros("");
    (async () => {
      try {
        const params = {};
        if (lga) params.lga = lga.toUpperCase();
        const { data } = await api.get("/api/barbers", { params });
        if (!on) return;
        setPros(Array.isArray(data) ? data : []);
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
  }, [lga]);

  // client filtering/ranking
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
    return [...pros]
      .map((p) => {
        const name = String(p?.name || "").toLowerCase();
        const desc = String(p?.bio || p?.description || "").toLowerCase();
        const proLga = String(p?.lga || "").toUpperCase();
        const servicesLC = svcArray(p);

        const matchName = term ? name.includes(term) || desc.includes(term) : true;
        const matchSvc = service ? servicesLC.includes(service.toLowerCase()) : true;
        const matchLga = lga ? proLga === lga.toUpperCase() : true;

        let score = 0;
        if (service && matchSvc) score += 3;
        if (lga && matchLga) score += 2;
        if (term && matchName) score += 1;

        return { p, ok: matchName && matchSvc && matchLga, score };
      })
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [pros, q, service, lga]);

  const lgasForState = useMemo(() => {
    return stateName && lgasByState[stateName] ? lgasByState[stateName] : [];
  }, [stateName, lgasByState]);

  function clearFilters() {
    setQ("");
    setService("");
    setStateName("");
    setLga("");
  }

  // feed load (optionally scoped by LGA)
  const fetchFeed = useCallback(async () => {
    try {
      setLoadingFeed(true);
      setErrFeed("");
      const params = {};
      if (lga) params.lga = lga.toUpperCase();
      const r = await api.get("/api/feed/public", { params }).catch(() => ({ data: [] }));
      setFeed(Array.isArray(r.data) ? r.data : []);
    } catch {
      setErrFeed("Could not load feed.");
    } finally {
      setLoadingFeed(false);
    }
  }, [lga]);

  useEffect(() => {
    let on = true;
    (async () => {
      await fetchFeed();
    })();
    return () => {
      on = false;
    };
  }, [fetchFeed, tab]);

  // go to book with carry-forward context
  function goBook(pro, chosenService) {
    const svcName = chosenService || service || null;

    const svcList = Array.isArray(pro?.services)
      ? pro.services.map((s) => (typeof s === "string" ? { name: s } : s))
      : [];
    const svcPrice = svcName ? svcList.find((s) => s.name === svcName)?.price : undefined;

    const proId = pro?.id || pro?._id; // ✅ support both shapes
    if (!proId) return;

    navigate(`/book/${proId}?service=${encodeURIComponent(svcName || "")}`, {
      state: {
        proId,
        serviceName: svcName || undefined,
        amountNaira: typeof svcPrice !== "undefined" ? svcPrice : undefined,
        country: "Nigeria",
        state: stateName || "",
        lga: (lga || "").toUpperCase(),
      },
    });
  }

  return (
    <ErrorBoundary>
      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* Header + tabs */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">Discover</h1>
          <div className="inline-flex rounded-xl border border-zinc-800 overflow-hidden">
            <button
              className={`px-4 py-2 text-sm ${
                tab === "pros" ? "bg-gold text-black font-semibold" : "hover:bg-zinc-900"
              }`}
              onClick={() => setTab("pros")}
            >
              Pros
            </button>
            <button
              className={`px-4 py-2 text-sm border-l border-zinc-800 ${
                tab === "feed" ? "bg-gold text-black font-semibold" : "hover:bg-zinc-900"
              }`}
              onClick={() => setTab("feed")}
            >
              Feed
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or description…"
            className="bg-black border border-zinc-800 rounded-lg px-3 py-2 w-56"
          />

          <div className="w-56">
            <ServicePicker value={service} onChange={setService} placeholder="All services" allowCustom={false} />
          </div>

          <select
            value={stateName}
            onChange={(e) => {
              setStateName(e.target.value);
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
            onChange={(e) => setLga(e.target.value)}
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

          <button onClick={clearFilters} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">
            Clear
          </button>
        </div>

        {/* Content */}
        {tab === "pros" ? (
          <>
            {errPros && (
              <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">{errPros}</div>
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
              <div className="text-zinc-400">No professionals match your filters.</div>
            )}
          </>
        ) : (
          <>
            {isPro && <FeedComposer lga={lga} onPosted={fetchFeed} />}

            {errFeed && (
              <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">{errFeed}</div>
            )}

            {loadingFeed ? (
              <p className="text-zinc-400">Loading feed…</p>
            ) : feed.length ? (
              <div className="grid md:grid-cols-2 gap-4">
                {feed.map((post) => (
                  <FeedCard key={post._id || post.id} post={post} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
                No updates yet. Once professionals start posting photos and promos, they’ll appear here. You can still
                book from the Pros tab.
              </div>
            )}
          </>
        )}

        {/* Drawer */}
        <ProDrawer
          open={!!openPro}
          pro={openPro}
          onClose={() => setOpenPro(null)}
          onBook={(svc) => (openPro ? goBook(openPro, svc) : null)} // ✅ fixed
        />
      </div>
    </ErrorBoundary>
  );
}
