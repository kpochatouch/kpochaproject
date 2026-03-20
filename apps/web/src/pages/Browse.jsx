// apps/web/src/pages/Browse.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import BarberCard from "../components/BarberCard";
import ServicePicker from "../components/ServicePicker";
import ProDrawer from "../components/ProDrawer";
import FeedCard from "../components/FeedCard";
import ErrorBoundary from "../components/ErrorBoundary";
import SideMenu from "../components/SideMenu.jsx";
import FeedComposer from "../components/FeedComposer.jsx";
import { connectSocket, registerSocketHandler } from "../lib/api";
import StoriesRail from "../components/StoriesRail.jsx";
import AdvertCardFeed from "../components/AdvertCardFeed.jsx";
import AdvertCardRail from "../components/AdvertCardRail.jsx";
import { handleAdvertClick as runAdvertClick } from "../lib/advertActions";

/* ---------------- Main Browse page ---------------- */
export default function Browse() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me } = useMe();

  // derive initial tab from URL (?tab=pros) but default to "feed"
  const [tab, setTab] = useState(() => {
    const qs = new URLSearchParams(location.search);
    const t = (qs.get("tab") || "").toLowerCase();
    return t === "pros" ? "pros" : "feed";
  });

  const [pros, setPros] = useState([]);
  const [loadingPros, setLoadingPros] = useState(false);
  const [errPros, setErrPros] = useState("");

  const [q, setQ] = useState("");
  const [service, setService] = useState(""); // service NAME
  const [stateName, setStateName] = useState("");
  const [lga, setLga] = useState("");

  const [states, setStates] = useState([]);
  const [lgasByState, setLgasByState] = useState({});

  const [openPro, setOpenPro] = useState(null);

  // feed states with cursor-based pagination
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errFeed, setErrFeed] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 8;

  const [feedAdverts, setFeedAdverts] = useState([]);
  const [railAdverts, setRailAdverts] = useState([]);

  // sentinel + latest state refs
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const loadingFeedRef = useRef(loadingFeed);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    loadingFeedRef.current = loadingFeed;
  }, [loadingFeed]);

  const isFeedTab = tab === "feed";
  const isProsTab = tab === "pros";

  // helper to sync tab with URL
  function setTabAndUrl(nextTab) {
    setTab(nextTab);
    const qs = new URLSearchParams(location.search);
    if (nextTab === "feed") {
      qs.delete("tab");
    } else {
      qs.set("tab", nextTab);
    }
    navigate(
      { pathname: location.pathname, search: qs.toString() },
      { replace: true },
    );
  }

  // keep tab in sync if URL changes externally (back/forward etc.)
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const t = (qs.get("tab") || "").toLowerCase();
    const desired = t === "pros" ? "pros" : "feed";
    setTab((prev) => (prev === desired ? prev : desired));

    // if ?post= is present, force feed tab (we'll extend this later if we ever auto-scroll)
    if (qs.get("post")) {
      setTab("feed");
    }
  }, [location.search]);

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
    if (!isProsTab) return;
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
  }, [isProsTab, lga, stateName]);

  // Normalize services for each pro -> array of lowercased service NAMES
  function svcArray(p) {
    const raw = p?.services;
    if (Array.isArray(raw))
      return raw
        .map((s) => (typeof s === "string" ? s : s?.name))
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
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
    const selectedServiceName = (service || "").toLowerCase();

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

        const matchName = term
          ? name.includes(term) || desc.includes(term)
          : true;

        const matchSvc = selectedServiceName
          ? servicesLC.includes(selectedServiceName)
          : true;

        const matchState = selectedState ? proState === selectedState : true;
        const matchLga = selectedLga ? proLga === selectedLga : true;

        let score = 0;
        if (selectedServiceName && matchSvc) score += 3;
        if (selectedLga && matchLga) score += 2;
        if (selectedState && matchState) score += 2;
        if (term && matchName) score += 1;

        return {
          p,
          ok: matchName && matchSvc && matchState && matchLga,
          score,
        };
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

  // fetch feed (cursor-based)
  const fetchFeed = useCallback(
    async ({ append = false, before = null } = {}) => {
      try {
        if (append) setLoadingMore(true);
        else setLoadingFeed(true);

        setErrFeed("");
        const params = { limit: pageSize };
        if (lga) params.lga = lga.toUpperCase();

        if (before) {
          try {
            const parsed = new Date(before);
            if (!isNaN(parsed.getTime())) {
              params.before = parsed.toISOString();
            } else {
              params.before = before;
            }
          } catch {
            params.before = before;
          }
        }

        const r = await api
          .get("/api/posts/public", { params })
          .catch(() => ({ data: [] }));

        const list = Array.isArray(r.data)
          ? r.data
          : Array.isArray(r.data?.items)
          ? r.data.items
          : [];

        if (append) {
          setFeed((prev) => {
            const existingIds = new Set(prev.map((f) => f._id || f.id));
            const newItems = list.filter(
              (it) => !existingIds.has(it._id || it.id),
            );
            return newItems.length ? [...prev, ...newItems] : prev;
          });
        } else {
          setFeed(list);
        }

        if (!list.length || list.length < pageSize) setHasMore(false);
        else setHasMore(true);
      } catch (err) {
        console.error("fetchFeed error:", err);
        setErrFeed("Could not load feed.");
      } finally {
        setLoadingFeed(false);
        setLoadingMore(false);
      }
    },
    [lga, pageSize],
  );

  // initial load & when lga or tab changes
  useEffect(() => {
    if (!isFeedTab) return;
    setHasMore(true);
    fetchFeed({ append: false, before: null });
  }, [fetchFeed, isFeedTab, lga]);

  // force feed tab if ?post= is present (already handled in the URL sync effect)

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || loadingMoreRef.current) return;
    const last = feed[feed.length - 1];
    if (!last) return;
    const rawCursor = last.createdAt || last._id || null;
    if (!rawCursor) return;
    const d = new Date(rawCursor);
    const before = isNaN(d.getTime()) ? rawCursor : d.toISOString();
    await fetchFeed({ append: true, before });
  }, [feed, fetchFeed]);

  // Realtime feed socket handlers
  useEffect(() => {
    if (!isFeedTab) return;

    try {
      connectSocket();
    } catch (e) {
      console.warn("connectSocket failed", e?.message || e);
    }

    const onPostCreated = (payload) => {
      try {
        if (!payload) return;
        if (lga) {
          const postLga = (
            payload.lga ||
            payload.ownerLga ||
            payload.locationLga ||
            ""
          ).toUpperCase();
          if (postLga && postLga !== (lga || "").toUpperCase()) return;
        }
        setFeed((prev) => {
          const id = payload._id || payload.id;
          if (!id) return [payload, ...prev];
          if (prev.some((p) => (p._id || p.id) === id)) return prev;
          return [payload, ...prev];
        });
      } catch (err) {
        console.warn("post:created handler failed", err);
      }
    };

    const onPostDeleted = (payload) => {
      try {
        const id = payload?.postId || payload?._id || payload?.id || null;
        if (!id) return;
        setFeed((prev) => prev.filter((p) => (p._id || p.id) !== id));
      } catch (err) {
        console.warn("post:deleted handler failed", err);
      }
    };

    const onPostStats = (payload) => {
      try {
        const id = payload?.postId || payload?.id || null;
        if (!id) return;
        setFeed((prev) =>
          prev.map((p) => {
            const pid = p._id || p.id;
            if (!pid || String(pid) !== String(id)) return p;
            return {
              ...p,
              stats: { ...(p.stats || {}), ...(payload.stats || payload) },
            };
          }),
        );
      } catch (err) {
        console.warn("post:stats handler failed", err);
      }
    };

    const unregisterCreated =
      typeof registerSocketHandler === "function"
        ? registerSocketHandler("post:created", onPostCreated)
        : null;
    const unregisterDeleted =
      typeof registerSocketHandler === "function"
        ? registerSocketHandler("post:deleted", onPostDeleted)
        : null;
    const unregisterStats =
      typeof registerSocketHandler === "function"
        ? registerSocketHandler("post:stats", onPostStats)
        : null;

    return () => {
      try {
        unregisterCreated && unregisterCreated();
      } catch {}
      try {
        unregisterDeleted && unregisterDeleted();
      } catch {}
      try {
        unregisterStats && unregisterStats();
      } catch {}
    };
  }, [isFeedTab, lga]);

  // setup IntersectionObserver for automatic infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (!isFeedTab) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (
              hasMoreRef.current &&
              !loadingMoreRef.current &&
              !loadingFeedRef.current
            ) {
              loadMore();
            }
          }
        }
      },
      { root: null, rootMargin: "800px", threshold: 0 },
    );

    observerRef.current.observe(sentinel);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [isFeedTab, loadMore]);

  function goBook(pro, chosenService) {
    const svcName = chosenService || service || null; // service NAME
    const svcList = Array.isArray(pro?.services)
      ? pro.services.map((s) => (typeof s === "string" ? { name: s } : s))
      : [];
    const svcPrice = svcName
      ? svcList.find(
          (s) => String(s.name).toLowerCase() === String(svcName).toLowerCase(),
        )?.price
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

  const canPostOnFeed = !!me;

  const fetchAdverts = useCallback(async () => {
    try {
      const [feedRes, railRes] = await Promise.all([
        api.get("/api/adverts/active/list", { params: { placement: "feed" } }),
        api.get("/api/adverts/active/list", {
          params: { placement: "right_rail" },
        }),
      ]);

      setFeedAdverts(Array.isArray(feedRes.data) ? feedRes.data : []);
      setRailAdverts(Array.isArray(railRes.data) ? railRes.data : []);
    } catch (err) {
      console.warn("fetch adverts failed", err?.message || err);
      setFeedAdverts([]);
      setRailAdverts([]);
    }
  }, []);

  useEffect(() => {
    if (!isFeedTab) return;
    fetchAdverts();
  }, [isFeedTab, fetchAdverts]);

  function injectFeedAdverts(posts = [], adverts = []) {
    if (!Array.isArray(posts) || !posts.length) return [];

    const out = [];
    let adIndex = 0;

    posts.forEach((post, index) => {
      out.push({
        kind: "post",
        data: post,
        key: `post-${post?._id || post?.id || index}`,
      });

      const shouldInsert = (index + 1) % 4 === 0;
      if (shouldInsert && Array.isArray(adverts) && adverts[adIndex]) {
        out.push({
          kind: "advert",
          data: adverts[adIndex],
          key: `advert-${adverts[adIndex]?._id || adIndex}-${index}`,
        });
        adIndex += 1;
      }
    });

    return out;
  }

  async function handleAdvertClick(advert) {
    await runAdvertClick({ advert, navigate });
  }

  const feedWithAdverts = useMemo(() => {
    return injectFeedAdverts(feed, feedAdverts);
  }, [feed, feedAdverts]);

  return (
    <ErrorBoundary>
      <div className="max-w-[1440px] mx-auto px-4 md:px-5 py-5 md:py-6">
        {/* header + tabs */}
        <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <img
              src="/discovery.png"
              alt="Discover"
              className="w-6 h-6 object-contain max-w-full"
            />
            <h1 className="text-[32px] leading-none font-semibold">Discover</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* tab pills */}
            <div
              className="inline-flex rounded-xl border overflow-hidden"
              style={{ borderColor: "var(--app-border)" }}
            >
              <button
                className={`px-4 py-2.5 text-[15px] font-medium border-r ${
                  isFeedTab ? "bg-gold text-black font-semibold" : ""
                }`}
                style={{
                  borderRightColor: "var(--app-border)",
                  color: isFeedTab ? "#000" : "var(--app-text)",
                  backgroundColor: isFeedTab ? undefined : "var(--app-surface)",
                }}
                onClick={() => setTabAndUrl("feed")}
                type="button"
              >
                Feed
              </button>
              <button
                className={`px-4 py-2.5 text-[15px] font-medium ${
                  isProsTab ? "bg-gold text-black font-semibold" : ""
                }`}
                style={{
                  color: isProsTab ? "#000" : "var(--app-text)",
                  backgroundColor: isProsTab ? undefined : "var(--app-surface)",
                }}
                onClick={() => setTabAndUrl("pros")}
                type="button"
              >
                Pros
              </button>
            </div>
          </div>
        </div>

        {/* filters — only show on Pros tab */}
        {isProsTab && (
          <div className="max-w-6xl mx-auto mb-7">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto] gap-3 items-start">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name or description…"
                  className="w-full rounded-xl px-4 py-3 text-[15px]"
                  style={{
                    backgroundColor: "var(--app-surface)",
                    border: "1px solid var(--app-border)",
                    color: "var(--app-text)",
                  }}
                />

                <div className="w-full">
                  <ServicePicker
                    value={service}
                    onChange={(_value, meta) => setService(meta?.name || "")}
                    placeholder="All services"
                    includeOther={false}
                  />
                </div>
              </div>

              <select
                value={stateName}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setStateName(val);
                  setLga("");
                }}
                className="w-full rounded-xl px-4 py-3 text-[15px]"
                style={{
                  backgroundColor: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
                  color: "var(--app-text)",
                }}
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
                className="w-full rounded-xl px-4 py-3 text-[15px]"
                style={{
                  backgroundColor: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
                  color: "var(--app-text)",
                }}
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
                className="rounded-xl px-4 py-3 text-[15px] font-medium"
                style={{
                  border: "1px solid var(--app-border)",
                  backgroundColor: "var(--app-surface)",
                  color: "var(--app-text)",
                }}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* content */}
        {isProsTab ? (
          <div className="max-w-6xl mx-auto">
            {errPros && (
              <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
                {errPros}
              </div>
            )}
            {loadingPros ? (
              <p style={{ color: "var(--app-text-soft)" }}>Loading…</p>
            ) : filteredAndRanked.length ? (
              <div className="space-y-4">
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
              <div
                className="rounded-2xl px-6 py-10 text-center"
                style={{
                  border: "1px solid var(--app-border)",
                  backgroundColor: "var(--app-surface)",
                  color: "var(--app-text-soft)",
                }}
              >
                No professionals match your filters.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_minmax(0,1fr)_260px] gap-3 md:gap-4 items-start">
            {/* LEFT MENU */}
            <div className="lg:w-56 w-full self-start lg:sticky lg:top-20">
              <SideMenu me={me} />
            </div>

            {/* FEED */}
            <div className="w-full min-w-0 max-w-none">
              {canPostOnFeed && (
                <FeedComposer
                  lga={lga}
                  onPosted={() => fetchFeed({ append: false, before: null })}
                />
              )}

              <StoriesRail />
              {errFeed && (
                <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
                  {errFeed}
                </div>
              )}

              {loadingFeed ? (
                <p className="text-zinc-400">Loading feed…</p>
              ) : feed.length ? (
                <>
                  <div className="space-y-4">
                    {feedWithAdverts.map((item, idx) => {
                      if (item?.kind === "advert") {
                        return (
                          <AdvertCardFeed
                            key={item.key || item.data?._id || `ad-${idx}`}
                            advert={item.data}
                            onClickAction={handleAdvertClick}
                          />
                        );
                      }

                      if (item?.kind === "post" && item?.data) {
                        const post = item.data;
                        return (
                          <FeedCard
                            key={
                              item.key || post._id || post.id || `post-${idx}`
                            }
                            post={post}
                            currentUser={
                              me ? { uid: me.uid || me.id, ...me } : null
                            }
                            onDeleted={() =>
                              fetchFeed({ append: false, before: null })
                            }
                          />
                        );
                      }
                      return null;
                    })}
                  </div>

                  {/* invisible sentinel */}
                  <div ref={sentinelRef} className="h-1 w-full" aria-hidden />

                  <div className="mt-6 flex justify-center">
                    {loadingMore ? (
                      <div className="text-sm text-zinc-400">Loading…</div>
                    ) : hasMore ? (
                      <button
                        onClick={loadMore}
                        className="flex items-center gap-2 px-4 py-2 rounded-md border border-zinc-700 hover:bg-zinc-900"
                        aria-label="Load more posts"
                        type="button"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          className="w-5 h-5"
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                        <span className="text-sm">Load more</span>
                      </button>
                    ) : (
                      <div className="text-xs text-zinc-500">No more posts</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
                  No updates yet.
                </div>
              )}
            </div>

            {/* RIGHT ADS */}
            <div className="hidden lg:block w-[240px] self-start lg:top-20 lg:sticky">
              <div className="space-y-3">
                <AdvertCardRail
                  advert={railAdverts?.[0] || null}
                  onClickAction={handleAdvertClick}
                />
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
