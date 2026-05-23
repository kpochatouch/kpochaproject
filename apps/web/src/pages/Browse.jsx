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
import SkeletonFeed from "../components/SkeletonFeed.jsx";
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

  const FEED_SCROLL_KEY = `kpocha:browse:scroll:v2:${(
    lga || "ALL"
  ).toUpperCase()}`;

  const FEED_CACHE_KEY = `kpocha:lastBrowseFeed:v1:${(
    lga || "ALL"
  ).toUpperCase()}`;

  function cacheFeed(list = []) {
    try {
      const toSave = Array.isArray(list) ? list.slice(0, 40) : [];
      sessionStorage.setItem(FEED_CACHE_KEY, JSON.stringify(toSave));
    } catch {}
  }

  // sentinel + latest state refs
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const loadingFeedRef = useRef(loadingFeed);
  const restoredScrollRef = useRef(false);
  const nextBeforeRef = useRef(null);
  const loopModeRef = useRef(false);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    loopModeRef.current = !hasMore;
  }, [hasMore]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    loadingFeedRef.current = loadingFeed;
  }, [loadingFeed]);
  useEffect(() => {
    restoredScrollRef.current = false;
  }, [FEED_SCROLL_KEY]);

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

  function dedupePosts(list = []) {
    const seen = new Set();
    return list.filter((item) => {
      const id = item?._id || item?.id;
      if (!id) return false;
      if (seen.has(String(id))) return false;
      seen.add(String(id));
      return true;
    });
  }

  function shufflePosts(list = []) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildMixedBrowseFeed({ trending = [], recent = [] } = {}) {
    const t = shufflePosts(trending);
    const r = shufflePosts(recent);

    const out = [];
    let ti = 0;
    let ri = 0;

    // pattern: 1 trending, 2 recent
    while (ti < t.length || ri < r.length) {
      if (ti < t.length) out.push(t[ti++]);
      if (ri < r.length) out.push(r[ri++]);
      if (ri < r.length) out.push(r[ri++]);
    }

    return dedupePosts(out);
  }

  function getOldestCursor(list = []) {
    let oldestTs = null;
    let oldestRaw = null;

    for (const item of list) {
      const raw = item?.createdAt || item?._id || null;
      if (!raw) continue;

      const d = new Date(raw);
      const ts = isNaN(d.getTime()) ? null : d.getTime();

      if (ts === null) continue;

      if (oldestTs === null || ts < oldestTs) {
        oldestTs = ts;
        oldestRaw = d.toISOString();
      }
    }

    return oldestRaw;
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

        // INITIAL LOAD FOR BROWSE:
        // mix trending + public recent so the first screen is not always newest-first
        if (!append && !before) {
          const [recentRes, trendingRes] = await Promise.all([
            api
              .get("/api/posts/public", { params })
              .catch(() => ({ data: [] })),
            api
              .get("/api/posts/trending", {
                params: {
                  limit: pageSize,
                  ...(lga ? { lga: lga.toUpperCase() } : {}),
                },
              })
              .catch(() => ({ data: [] })),
          ]);

          const recent = Array.isArray(recentRes.data)
            ? recentRes.data
            : Array.isArray(recentRes.data?.items)
            ? recentRes.data.items
            : [];

          const trending = Array.isArray(trendingRes.data)
            ? trendingRes.data
            : Array.isArray(trendingRes.data?.items)
            ? trendingRes.data.items
            : [];

          const mixed = buildMixedBrowseFeed({ trending, recent });
          const nextBefore = getOldestCursor(recent);

          nextBeforeRef.current = nextBefore;

          setFeed(mixed);
          try {
            cacheFeed(mixed);
          } catch {}
          setHasMore(recent.length >= pageSize && !!nextBefore);
          return;
        }

        // PAGINATION:
        // keep loading older public posts, but do not disturb the mixed first screen
        const r = await api
          .get("/api/posts/public", { params })
          .catch(() => ({ data: [] }));

        const list = Array.isArray(r.data)
          ? r.data
          : Array.isArray(r.data?.items)
          ? r.data.items
          : [];

        const nextBefore = getOldestCursor(list);
        nextBeforeRef.current = nextBefore;

        if (append) {
          setFeed((prev) => {
            const existingIds = new Set(
              prev.map((f) => String(f?._id || f?.id)),
            );

            const newItems = list.filter(
              (it) => !existingIds.has(String(it?._id || it?.id)),
            );

            if (!newItems.length) return prev;

            const shuffledPage = shufflePosts(newItems);
            const next = [...prev, ...shuffledPage];
            try {
              cacheFeed(next);
            } catch {}
            return next;
          });
        } else {
          setFeed(list);
          try {
            cacheFeed(list);
          } catch {}
        }

        if (!list.length || list.length < pageSize || !nextBefore) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
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

  useEffect(() => {
    if (!isFeedTab) return;

    // Attempt to restore a cached feed snapshot while the backend wakes
    try {
      const raw = sessionStorage.getItem(FEED_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          setFeed(parsed);
          // mark that we restored from cache; real fetch will replace/update
        }
      }
    } catch {}

    setHasMore(true);
    fetchFeed({ append: false, before: null });
  }, [fetchFeed, isFeedTab, lga]);

  useEffect(() => {
    if (!isFeedTab) return;

    function saveScroll() {
      try {
        sessionStorage.setItem(
          FEED_SCROLL_KEY,
          String(window.scrollY || window.pageYOffset || 0),
        );
      } catch {}
    }

    window.addEventListener("scroll", saveScroll, { passive: true });
    saveScroll();

    return () => {
      window.removeEventListener("scroll", saveScroll);
    };
  }, [isFeedTab, FEED_SCROLL_KEY]);

  useEffect(() => {
    if (!isFeedTab) return;
    if (!feed.length) return;
    if (restoredScrollRef.current) return;

    try {
      const raw = sessionStorage.getItem(FEED_SCROLL_KEY);
      const y = Number(raw || 0);

      if (Number.isFinite(y) && y > 0) {
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
    } catch {}

    restoredScrollRef.current = true;
  }, [isFeedTab, FEED_SCROLL_KEY, feed.length]);

  // force feed tab if ?post= is present (already handled in the URL sync effect)

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loadingFeedRef.current) return;

    if (!hasMoreRef.current) {
      setFeed((prev) => (prev.length ? shufflePosts(prev) : prev));
      return;
    }

    const before = nextBeforeRef.current;
    if (!before) {
      setHasMore(false);
      setFeed((prev) => (prev.length ? shufflePosts(prev) : prev));
      return;
    }

    await fetchFeed({ append: true, before });
  }, [fetchFeed]);

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
          if (!id) return prev;
          if (prev.some((p) => (p._id || p.id) === id)) return prev;

          // Keep current Browse ranking stable.
          // New posts should not jump to the very top while user is browsing.
          if (!prev.length) return [payload];
          return prev;
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
    if (!isFeedTab) return;
    if (!feed.length) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (
              (hasMoreRef.current || loopModeRef.current) &&
              !loadingMoreRef.current &&
              !loadingFeedRef.current
            ) {
              loadMore();
            }
          }
        }
      },
      { root: null, rootMargin: "800px 0px", threshold: 0 },
    );

    observerRef.current.observe(sentinel);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [isFeedTab, feed.length, loadMore]);

  useEffect(() => {
    if (!isFeedTab) return;
    if (!feed.length) return;
    if (loadingFeed || loadingMore) return;

    const doc = document.documentElement;
    const pageTooShort =
      (doc?.scrollHeight || 0) <= (window.innerHeight || 0) + 120;

    if (!pageTooShort) return;
    if (!(hasMore || loopModeRef.current)) return;

    const id = requestAnimationFrame(() => {
      loadMore();
    });

    return () => cancelAnimationFrame(id);
  }, [isFeedTab, feed.length, loadingFeed, loadingMore, hasMore, loadMore]);

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
          <div className="flex items-start gap-3">
            <img
              src="/discovery.png"
              alt="Discover"
              className="w-6 h-6 object-contain max-w-full mt-1"
            />
            <div>
              <h1 className="text-[32px] leading-none font-semibold">
                Discover
              </h1>
              <p
                className="mt-2 text-sm md:text-[15px] max-w-[760px]"
                style={{ color: "var(--app-text-soft)" }}
              >
                Discover professionals, explore real work, share updates, and
                book trusted services — all in one place.
              </p>
            </div>
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
                Showcase
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
                Book Pros
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
                No professionals match your filters yet. Try widening your
                search and discover more trusted talent.
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
                <SkeletonFeed items={4} />
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

                  {/* auto-load sentinel */}
                  <div ref={sentinelRef} className="w-full h-16" aria-hidden />

                  <div className="mt-2 mb-4 flex justify-center pointer-events-none">
                    {loadingMore ? (
                      <div className="text-sm text-zinc-400">Loading more…</div>
                    ) : !hasMore ? (
                      <div className="text-xs text-zinc-500">
                        Shuffling feed…
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
                  No showcases yet. New work, fresh updates, and trusted
                  services will appear here.
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
