// apps/web/src/pages/Browse.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import BarberCard from "../components/BarberCard";
import ServicePicker from "../components/ServicePicker";
import ProDrawer from "../components/ProDrawer";
import FeedCard from "../components/FeedCard";

export default function Browse() {
  const [tab, setTab] = useState("pros"); // "pros" | "feed"

  // -------- pros directory state --------
  const [pros, setPros] = useState([]);
  const [loadingPros, setLoadingPros] = useState(true);
  const [errPros, setErrPros] = useState("");

  // filters (shared UI – only Pros tab uses them for now)
  const [q, setQ] = useState("");
  const [service, setService] = useState("");
  const [stateName, setStateName] = useState("");
  const [lga, setLga] = useState("");

  // NG Geo
  const [states, setStates] = useState([]);
  const [lgasByState, setLgasByState] = useState({});

  // drawer
  const [openPro, setOpenPro] = useState(null);

  // -------- feed state --------
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [errFeed, setErrFeed] = useState("");

  // load NG geo
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
    return () => { on = false; };
  }, []);

  // load pros (respect LGA filter server-side)
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
    return () => { on = false; };
  }, [lga]);

  // client-side filtering/ranking
  function svcArray(p) {
    const raw = p?.services;
    if (Array.isArray(raw)) return raw.map(s => (typeof s === "string" ? s : s?.name)).filter(Boolean).map(s => s.toLowerCase());
    if (typeof raw === "string") return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    return [];
  }

  const filteredAndRanked = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...pros]
      .map(p => {
        const name = String(p?.name || "").toLowerCase();
        const desc = String(p?.bio || p?.description || "").toLowerCase();
        const proLga = String(p?.lga || "").toUpperCase();
        const servicesLC = svcArray(p);

        const matchName = term ? (name.includes(term) || desc.includes(term)) : true;
        const matchSvc  = service ? servicesLC.includes(service.toLowerCase()) : true;
        const matchLga  = lga ? proLga === lga.toUpperCase() : true;

        let score = 0;
        if (service && matchSvc) score += 3;
        if (lga && matchLga)     score += 2;
        if (term && matchName)   score += 1;

        return { p, ok: matchName && matchSvc && matchLga, score };
      })
      .filter(x => x.ok)
      .sort((a,b) => b.score - a.score)
      .map(x => x.p);
  }, [pros, q, service, lga]);

  const lgasForState = useMemo(() => {
    return stateName && lgasByState[stateName] ? lgasByState[stateName] : [];
  }, [stateName, lgasByState]);

  function clearFilters() {
    setQ(""); setService(""); setStateName(""); setLga("");
  }

  // -------- Feed: load public posts (safe: endpoint may return []) --------
  useEffect(() => {
    let on = true;
    setLoadingFeed(true);
    setErrFeed("");
    (async () => {
      try {
        const params = {};
        if (lga) params.lga = lga.toUpperCase();
        const { data } = await api.get("/api/feed/public", { params }).catch(() => ({ data: [] }));
        if (!on) return;
        setFeed(Array.isArray(data) ? data : []);
      } catch {
        if (!on) return;
        setErrFeed("Could not load feed.");
      } finally {
        if (on) setLoadingFeed(false);
      }
    })();
    return () => { on = false; };
    // note: LGA also scopes the feed if backend supports it
  }, [lga]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* Header + tabs */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Discover</h1>
        <div className="inline-flex rounded-xl border border-zinc-800 overflow-hidden">
          <button
            className={`px-4 py-2 text-sm ${tab==="pros" ? "bg-gold text-black font-semibold" : "hover:bg-zinc-900"}`}
            onClick={() => setTab("pros")}
          >
            Pros
          </button>
          <button
            className={`px-4 py-2 text-sm border-l border-zinc-800 ${tab==="feed" ? "bg-gold text-black font-semibold" : "hover:bg-zinc-900"}`}
            onClick={() => setTab("feed")}
          >
            Feed
          </button>
        </div>
      </div>

      {/* Filters (shown on both tabs for consistency; Pros tab actually uses them fully) */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or description…"
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2 w-56"
        />

        <div className="w-56">
          <ServicePicker
            value={service}
            onChange={setService}
            placeholder="All services"
            allowCustom={false}
          />
        </div>

        <select
          value={stateName}
          onChange={(e) => { setStateName(e.target.value); setLga(""); }}
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
        >
          <option value="">All States</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={lga}
          onChange={(e) => setLga(e.target.value)}
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2"
          disabled={stateName && !lgasForState.length}
        >
          <option value="">All LGAs</option>
          {(stateName ? lgasForState : []).map(x => <option key={x} value={x}>{x}</option>)}
        </select>

        <button onClick={clearFilters} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">
          Clear
        </button>
      </div>

      {/* --- TAB CONTENT --- */}
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
                <BarberCard key={pro.id || pro._id} barber={pro} onOpen={setOpenPro} />
              ))}
            </div>
          ) : (
            <div className="text-zinc-400">No professionals match your filters.</div>
          )}
        </>
      ) : (
        <>
          {errFeed && (
            <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
              {errFeed}
            </div>
          )}

          {loadingFeed ? (
            <p className="text-zinc-400">Loading feed…</p>
          ) : feed.length ? (
            // Masonry-ish single column on mobile, two on desktop
            <div className="grid md:grid-cols-2 gap-4">
              {feed.map((post) => (
                <FeedCard key={post._id || post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
              No updates yet. Once professionals start posting photos and promos,
              they’ll appear here. You can still book from the Pros tab.
            </div>
          )}
        </>
      )}

      {/* Drawer for full pro profile */}
      <ProDrawer open={!!openPro} pro={openPro} onClose={() => setOpenPro(null)} />
    </div>
  );
}
