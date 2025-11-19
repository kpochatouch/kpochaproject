// apps/web/src/pages/PublicProfile.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, connectSocket, registerSocketHandler } from "../lib/api";
import FeedCard from "../components/FeedCard.jsx";
import LiveActivity from "../components/LiveActivity.jsx";
import NotificationsMenu from "../components/NotificationsMenu.jsx";
import SideMenu from "../components/SideMenu.jsx";
import FeedComposer from "../components/FeedComposer.jsx";

function normalizeProfile(data) {
  if (!data) return null;
  if (data.profile) return data.profile;

  if (data.displayName || data.ownerUid || data.username || data.name || data.photoUrl) {
    return {
      ownerUid: data.ownerUid || data.uid || null,
      username: data.username || data.id || "",
      displayName: data.displayName || data.name || data.fullName || "",
      avatarUrl: data.photoUrl || data.avatarUrl || "",
      coverUrl: data.coverUrl || "",
      bio: data.bio || data.description || "",
      isPro: Boolean(data.proId || data.proOwnerUid || data.services),
      services: data.services || [],
      gallery: data.gallery || [],
      badges: data.badges || [],
      metrics: data.metrics || {},
      followersCount: data.metrics?.followers ?? data.followersCount ?? 0,
      postsCount: data.metrics?.postsCount ?? data.postsCount ?? 0,
      jobsCompleted: data.metrics?.jobsCompleted ?? data.jobsCompleted ?? 0,
      ratingAverage: data.metrics?.avgRating ?? data.rating ?? 0,
      id: data._id || data.id || undefined,
      _posts: data.posts || null,
      state: data.state || data.locationState || "",
      lga: data.lga || data.locationLga || "",
    };
  }


  return null;
}

// --- canonical owner uid helper (use everywhere instead of trusting ownerUid) ---
function canonicalOwnerUid(p) {
  if (!p) return null;
  return (
    p.ownerUid ||
    p.uid ||
    p.id ||
    p._id ||
    p.userId ||
    p.userUid ||
    (p.owner && (p.owner.uid || p.owner.userId)) ||
    null
  );
}


export default function PublicProfile() {
  const { username: routeParam } = useParams();
  const idOrHandle = routeParam;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [err, setErr] = useState("");
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // adverts (right rail)
  const [adminAdUrl, setAdminAdUrl] = useState("");
  const [adMsg, setAdMsg] = useState("");

  // posts pagination / infinite scroll
  const pageSize = 8;
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const loadingPostsRef = useRef(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { loadingPostsRef.current = loadingPosts; }, [loadingPosts]);

  // fetch current user (best-effort) -> used for SideMenu + admin check + FeedCard actions
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/api/me").catch(() => null);
        if (!alive) return;
        setCurrentUser(res?.data || null);
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const isLikelyUid =
        typeof idOrHandle === "string" &&
        (idOrHandle.length > 20 || /^[0-9a-fA-F]{24}$/.test(idOrHandle));

      const candidates = isLikelyUid
        ? [
            `/api/profile/public-by-uid/${encodeURIComponent(idOrHandle)}`,
            `/api/barbers/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/pro/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/public/${encodeURIComponent(idOrHandle)}`,
          ]
        : [
            `/api/profile/public/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/pro/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/public-by-uid/${encodeURIComponent(idOrHandle)}`,
            `/api/barbers/${encodeURIComponent(idOrHandle)}`,
          ];

      let payloadProfile = null;
      let payloadPosts = [];

      for (const path of candidates) {
  try {
    const resp = await api.get(path);
    const data = resp?.data ?? null;
    if (!data) continue;

    // Helper: normalize a profile object so we always have ownerUid present
    function ensureProfileOwner(p) {
      if (!p || typeof p !== "object") return p;
      p.ownerUid =
        p.ownerUid ||
        p.uid ||
        p.id ||
        p._id ||
        p.userId ||
        p.userUid ||
        (p.owner && (p.owner.uid || p.owner.userId)) ||
        idOrHandle ||
        null;
      return p;
    }

    // Helper: normalize posts array and ensure each post has ownerUid
    function normalizePostsArray(arr) {
      if (!Array.isArray(arr)) return [];
      return arr.map((post) => {
        if (!post || typeof post !== "object") return post;
        // prefer explicit ownerUid fields but fall back to other shapes
        post.ownerUid =
          post.ownerUid ||
          post.proOwnerUid ||
          (post.pro && (post.pro.ownerUid || post.proOwnerUid)) ||
          post.createdBy ||
          post.uid ||
          post.userId ||
          post._ownerUid ||
          idOrHandle ||
          null;
        return post;
      });
    }

    if (data.profile) {
      payloadProfile = ensureProfileOwner(data.profile);
      // posts may be in data.posts.items or data.posts (array) or data._posts
      const postsCand =
        Array.isArray(data.posts) ? data.posts : data.posts?.items || data._posts || [];
      payloadPosts = normalizePostsArray(postsCand);
      break;
    }

    const normalized = normalizeProfile(data);
    if (normalized) {
      payloadProfile = ensureProfileOwner(normalized);

      // pick posts from several possible shapes
      if (data.posts) {
        payloadPosts = Array.isArray(data.posts)
          ? normalizePostsArray(data.posts)
          : normalizePostsArray(data.posts.items || []);
      } else if (data._posts) {
        payloadPosts = normalizePostsArray(Array.isArray(data._posts) ? data._posts : []);
      } else if (normalized._posts) {
        payloadPosts = normalizePostsArray(Array.isArray(normalized._posts) ? normalized._posts : []);
      } else {
        payloadPosts = [];
      }

      break;
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status && status !== 404) throw e;
  }
}


      // fallback: query posts by ownerUid
      if (payloadProfile && payloadPosts.length === 0) {
        try {
          const pid = encodeURIComponent(payloadProfile.ownerUid || payloadProfile.id || idOrHandle);
          const res = await api.get(`/api/posts?ownerUid=${pid}&limit=${pageSize}`);
          payloadPosts = res?.data?.items || res?.data || [];
        } catch {
          // ignore
        }
      }

      if (payloadProfile) {
        setProfile(payloadProfile);
        setPosts(payloadPosts || []);
        setHasMore((payloadPosts || []).length >= pageSize);
      } else {
        setProfile(null);
        setPosts([]);
        setErr("Profile not found.");
      }
    } catch (e) {
      console.error("public profile load:", e);
      setProfile(null);
      setPosts([]);
      setErr("Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [idOrHandle]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  /* ---------------- realtime handlers: profile stats + posts ---------------- */
  useEffect(() => {
    if (!canonicalOwnerUid(profile)) return;


    try { connectSocket(); } catch (e) { console.warn("connectSocket failed", e?.message || e); }

    // profile stats (followers count, etc.)
    const onProfileStats = (payload) => {
      try {
        if (!payload || payload.ownerUid !== profile.ownerUid) return;
        setProfile((p) => ({
          ...(p || {}),
          metrics: { ...(p?.metrics || {}), followers: payload.followersCount ?? p?.metrics?.followers },
          followersCount: payload.followersCount ?? p?.followersCount ?? p?.metrics?.followers,
        }));
      } catch (err) {
        console.warn("profile:stats handler failed", err?.message || err);
      }
    };

    // also accept old profile:follow payloads for backcompat
    const onProfileFollow = (payload) => {
      try {
        const owner = payload?.targetUid ?? payload?.target?.uid ?? payload?.ownerUid ?? null;
        if (!owner || owner !== profile.ownerUid) return;
        const followers = payload.followers ?? payload.followersCount ?? null;
        setProfile((p) => ({
          ...(p || {}),
          metrics: { ...(p?.metrics || {}), followers: followers ?? p?.metrics?.followers },
          followersCount: followers ?? p?.followersCount ?? p?.metrics?.followers,
        }));
      } catch (err) {
        console.warn("profile:follow handler failed", err?.message || err);
      }
    };

    // when a new post is created anywhere, if it belongs to this profile -> prepend
    const onPostCreated = (payload) => {
      try {
        if (!payload || !payload.ownerUid) return;
        if (String(payload.ownerUid) !== String(profile.ownerUid)) return;
        setPosts((prev) => {
          const id = payload._id || payload.id;
          if (!id) return [payload, ...prev];
          if (prev.some((p) => (p._id || p.id) === id)) return prev;
          return [payload, ...prev];
        });
      } catch (err) {
        console.warn("post:created handler failed", err?.message || err);
      }
    };

    // when a post is deleted -> remove from list
    const onPostDeleted = (payload) => {
      try {
        const id = payload?.postId || payload?._id || payload?.id || null;
        const owner = payload?.ownerUid || payload?.targetUid || null;
        // if owner specified and doesn't match, ignore; otherwise remove by id
        if (owner && String(owner) !== String(profile.ownerUid)) return;
        if (!id) return;
        setPosts((prev) => prev.filter((p) => (p._id || p.id) !== id));
      } catch (err) {
        console.warn("post:deleted handler failed", err?.message || err);
      }
    };

    // update per-post metrics (likes/comments) if payload refers to a post shown
    const onPostStats = (payload) => {
      try {
        const id = payload?.postId || payload?.id || null;
        if (!id) return;
        setPosts((prev) =>
          prev.map((p) => {
            const pid = p._id || p.id;
            if (!pid || String(pid) !== String(id)) return p;
            // merge metrics safely
            return { ...p, stats: { ...(p.stats || {}), ...(payload.stats || payload) } };
          })
        );
      } catch (err) {
        console.warn("post:stats handler failed", err?.message || err);
      }
    };

    const unregisterStats = typeof registerSocketHandler === "function"
      ? registerSocketHandler("profile:stats", onProfileStats)
      : null;
    const unregisterFollow = typeof registerSocketHandler === "function"
      ? registerSocketHandler("profile:follow", onProfileFollow)
      : null;

    // post events
    const unregisterPostCreated = typeof registerSocketHandler === "function"
      ? registerSocketHandler("post:created", onPostCreated)
      : null;
    const unregisterPostDeleted = typeof registerSocketHandler === "function"
      ? registerSocketHandler("post:deleted", onPostDeleted)
      : null;
    const unregisterPostStats = typeof registerSocketHandler === "function"
      ? registerSocketHandler("post:stats", onPostStats)
      : null;

    return () => {
      try { unregisterStats && unregisterStats(); } catch {}
      try { unregisterFollow && unregisterFollow(); } catch {}
      try { unregisterPostCreated && unregisterPostCreated(); } catch {}
      try { unregisterPostDeleted && unregisterPostDeleted(); } catch {}
      try { unregisterPostStats && unregisterPostStats(); } catch {}
    };
  }, [profile?.ownerUid]);

  /* ------------------------- follow / unfollow (optimistic) ------------------------- */
  useEffect(() => {
    if (!canonicalOwnerUid(profile)) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/api/follow/${encodeURIComponent(profile.ownerUid)}/status`);
        if (!alive) return;
        setFollowing(Boolean(data?.following));
      } catch (e) {
        console.warn("failed to load follow state", e?.message || e);
      }
    })();
    return () => { alive = false; };
  }, [profile?.ownerUid]);

  async function follow() {
    if (!profile?.ownerUid || followPending) return;
    setFollowPending(true);
    setFollowing(true);
    setProfile((p) => ({ ...(p || {}), followersCount: (p?.followersCount || 0) + 1, metrics: { ...(p?.metrics || {}), followers: (p?.metrics?.followers || 0) + 1 } }));
    try {
      const { data } = await api.post(`/api/follow/${encodeURIComponent(profile.ownerUid)}`);
      setProfile((p) => ({ ...(p || {}), followersCount: data?.followers ?? p?.followersCount, metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers } }));
    } catch (e) {
      console.error("follow failed", e);
      setFollowing(false);
      setProfile((p) => ({ ...(p || {}), followersCount: Math.max(0, (p?.followersCount || 1) - 1), metrics: { ...(p?.metrics || {}), followers: Math.max(0, (p?.metrics?.followers || 1) - 1) } }));
    } finally {
      setFollowPending(false);
    }
  }

  async function unfollow() {
    if (!profile?.ownerUid || followPending) return;
    setFollowPending(true);
    setFollowing(false);
    setProfile((p) => ({ ...(p || {}), followersCount: Math.max(0, (p?.followersCount || 1) - 1), metrics: { ...(p?.metrics || {}), followers: Math.max(0, (p?.metrics?.followers || 1) - 1) } }));
    try {
      const { data } = await api.delete(`/api/follow/${encodeURIComponent(profile.ownerUid)}`);
      setProfile((p) => ({ ...(p || {}), followersCount: data?.followers ?? p?.followersCount, metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers } }));
    } catch (e) {
      console.error("unfollow failed", e);
      setFollowing(true);
      setProfile((p) => ({ ...(p || {}), followersCount: (p?.followersCount || 0) + 1, metrics: { ...(p?.metrics || {}), followers: (p?.metrics?.followers || 0) + 1 } }));
    } finally {
      setFollowPending(false);
    }
  }

  function startMessage() {
    if (!profile?.ownerUid) {
      alert("Cannot start chat: missing user id");
      return;
    }
    navigate(`/chat?with=${encodeURIComponent(profile.ownerUid)}`);
  }

  /* ------------------ Posts pagination & infinite scroll ------------------ */
  const fetchPosts = useCallback(
    async ({ append = false, before = null } = {}) => {
      if (!profile?.ownerUid) return;
      try {
        if (append) setLoadingMore(true);
        else setLoadingPosts(true);
        const params = { limit: pageSize, ownerUid: profile.ownerUid };
        if (before) params.before = before;
        const res = await api.get("/api/posts", { params }).catch(() => ({ data: [] }));
        const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.items) ? res.data.items : [];
        if (append) {
          setPosts((prev) => {
            const existing = new Set(prev.map((p) => p._id || p.id));
            const newItems = list.filter((it) => !existing.has(it._id || it.id));
            return newItems.length ? [...prev, ...newItems] : prev;
          });
        } else {
          setPosts(list);
        }
        if (!list.length || list.length < pageSize) setHasMore(false);
        else setHasMore(true);
      } catch (e) {
        console.error("fetchPosts error:", e);
      } finally {
        setLoadingMore(false);
        setLoadingPosts(false);
      }
    },
    [profile?.ownerUid]
  );

  // attach IntersectionObserver for infinite scroll
  useEffect(() => {
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
            if (hasMoreRef.current && !loadingMoreRef.current && !loadingPostsRef.current) {
              const last = posts[posts.length - 1];
              if (!last) return;
              const rawCursor = last.createdAt || last._id || null;
              if (!rawCursor) return;
              const d = new Date(rawCursor);
              const before = isNaN(d.getTime()) ? rawCursor : d.toISOString();
              fetchPosts({ append: true, before });
            }
          }
        }
      },
      { root: null, rootMargin: "800px", threshold: 0 }
    );
    observerRef.current.observe(sentinel);
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [posts, fetchPosts]);

  // ensure we refresh posts when profile changes
  useEffect(() => {
   if (!canonicalOwnerUid(profile)) return;
    fetchPosts({ append: false, before: null });
  }, [profile?.ownerUid, fetchPosts]);

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">Loading profile…</div>;
  if (err) return (
    <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">
      <p className="mb-3">{err}</p>
    </div>
  );
  if (!profile) return <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">Profile not found.</div>;

  const name = profile.displayName || profile.username || "Professional";
  const location = [profile.state, profile.lga].filter(Boolean).join(", ");
  const avatar = profile.avatarUrl || (profile.gallery && profile.gallery[0]) || "";
  const services = Array.isArray(profile.services) ? profile.services : [];
  const rating = Number(profile.ratingAverage || 0);
  const badges = Array.isArray(profile.badges) ? profile.badges : [];
  const gallery = Array.isArray(profile.gallery) ? profile.gallery : [];

  const isAdmin = Boolean(currentUser?.isAdmin);

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white">
      {/* Cover */}
      <div className="relative bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 h-44 z-10">
        <div className="absolute right-4 top-3 z-20">
          <NotificationsMenu />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 -mt-16 relative z-30">
        <div className="flex gap-6 items-end">
          <div className="w-32 h-32 rounded-full border-4 border-[#0b0c10] bg-zinc-900 overflow-hidden shrink-0 relative z-[9999]">
            {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl">{name.slice(0, 1)}</div>}
          </div>

          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{name}</h1>
              {badges.map((b, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-200 border border-emerald-700">{b}</span>
              ))}
            </div>

            <p className="text-sm text-zinc-400 mt-1">{location || "Nigeria"}</p>

            {rating > 0 && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                {Array.from({ length: Math.round(rating) }).map((_, i) => <span key={i} className="text-yellow-400">★</span>)}
                {Array.from({ length: 5 - Math.round(rating) }).map((_, i) => <span key={i} className="text-zinc-600">★</span>)}
                <span className="text-zinc-300 ml-1">{rating.toFixed(1)}</span>
              </div>
            )}
          </div>

          <div className="pb-3 flex gap-2">
            <a className="px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90" href={`/book/${profile.id || profile.username || idOrHandle}`}>Book now</a>
            <button className="px-4 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-200" title="Follow this profile" onClick={following ? unfollow : follow} disabled={followPending}>{followPending ? "…" : following ? "Unfollow" : "Follow"}</button>
            <button onClick={startMessage} className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm" title="Send message">Message</button>
          </div>
        </div>
      </div>

          {/* Main grid */}
      <div className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 lg:grid-cols-[14rem_1fr_14rem] gap-6 pb-10">

        {/* LEFT side menu for large screens - stays in column 1 */}
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-20">
            <SideMenu me={currentUser} />
          </div>
        </div>

        {/* MAIN column - middle column ONLY */}
        <div className="space-y-6">
          {(profile.bio || profile.description) && (
            <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
              <h2 className="text-lg font-semibold mb-2">About</h2>
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{profile.bio || profile.description}</p>
            </section>
          )}

          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Services</h2>
              <span className="text-xs text-zinc-500">Click a service during booking</span>
            </div>
            {services.length ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map((svc, i) => (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="font-medium">{svc.name || svc}</div>
                    {svc.price != null && <div className="text-sm text-zinc-200 mt-1">₦{Number(svc.price).toLocaleString()}</div>}
                    {svc.description && <div className="text-xs text-zinc-400 mt-1">{svc.description}</div>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-zinc-400">This professional has not listed services yet.</p>}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-3">Gallery</h2>
            {gallery.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {gallery.map((src, i) => (
                  <button key={i} onClick={() => window.open(src, "_blank")} className="block rounded-lg overflow-hidden border border-zinc-800">
                    <img src={src} alt="" className="w-full h-40 object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-zinc-400">No photos yet.</p>}
          </section>

          {/* composer (only show for logged-in users) */}
          {currentUser ? (
            <FeedComposer lga={profile.lga || ""} onPosted={() => fetchPosts({ append: false, before: null })} />
          ) : null}

          <section>
            <h3 className="text-lg font-semibold mb-3">Recent posts</h3>
            {loadingPosts ? (
              <p className="text-sm text-zinc-400">Loading posts…</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-zinc-400">No posts yet.</p>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <FeedCard key={p._id || p.id} post={p} currentUser={currentUser} onDeleted={() => fetchPosts({ append: false, before: null })} />
                ))}
              </div>
            )}

            {/* sentinel for infinite scroll */}
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
            <div className="mt-4 flex justify-center">
              {loadingMore ? <div className="text-sm text-zinc-400">Loading…</div> : !hasMore ? <div className="text-xs text-zinc-500">No more posts</div> : null}
            </div>
          </section>
        </div>

        {/* RIGHT ADS + stats - third column */}
        <div className="hidden lg:block">
          <div className="w-56 self-start lg:sticky lg:top-20 space-y-6">
            <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
              <h2 className="text-lg font-semibold mb-2">Stats</h2>
              <div className="text-sm text-zinc-200">
                <div><strong>{profile.followersCount ?? profile.metrics?.followers ?? 0}</strong> followers</div>
                <div><strong>{profile.postsCount ?? posts.length ?? 0}</strong> posts</div>
                <div><strong>{profile.jobsCompleted ?? 0}</strong> completed</div>
                <div><strong>{profile.ratingAverage ?? 0}</strong> rating</div>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
              <h2 className="text-lg font-semibold mb-2">Location</h2>
              <p className="text-sm text-zinc-200">{location || "Nigeria"}</p>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
              <h2 className="text-lg font-semibold mb-2">Live activity</h2>
              <LiveActivity ownerUid={profile.ownerUid} />
            </section>

            {/* Advert rail */}
            <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
              {isAdmin ? (
                <>
                  <div className="text-xs text-zinc-300 mb-2">Advert (admin only)</div>
                  <input
                    value={adminAdUrl}
                    onChange={(e) => { setAdminAdUrl(e.target.value); setAdMsg(""); }}
                    placeholder="Image / video URL"
                    className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs mb-2"
                  />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const localUrl = URL.createObjectURL(file);
                      setAdminAdUrl(localUrl);
                      setAdMsg("Local preview (not uploaded)");
                    }}
                    className="w-full text-[10px] text-zinc-400 mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (!adminAdUrl.trim()) return setAdMsg("Paste a media URL first.");
                        setAdMsg("Previewing…");
                        setTimeout(() => setAdMsg("Preview ready"), 250);
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
                            media: [{ url: adminAdUrl.trim(), type: /\.(mp4|mov|webm)$/i.test(adminAdUrl) ? "video" : "image" }],
                            isPublic: true,
                            tags: ["AD"],
                          });
                          setAdMsg("Published to feed ✔");
                          // refresh posts on profile
                          fetchPosts({ append: false, before: null });
                        } catch (e) {
                          setAdMsg(e?.response?.data?.error || "Failed to publish ad");
                        }
                      }}
                      className="flex-1 rounded-md bg-gold text-black px-2 py-1 text-xs font-semibold"
                    >
                      Publish
                    </button>
                  </div>
                  {adMsg && <p className="text-[10px] text-zinc-500 mt-2">{adMsg}</p>}
                </>
              ) : null}

              {adminAdUrl ? (
                <div className="rounded-lg border border-zinc-800 overflow-hidden bg-black/20 h-40 mt-3 flex items-center justify-center">
                  {adminAdUrl.match(/\.(mp4|mov|webm)$/i) ? (
                    <video src={adminAdUrl} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                  ) : (
                    <img src={adminAdUrl} alt="ad" loading="lazy" className="w-full h-full object-cover" />
                  )}
                </div>
              ) : (
                <div className="h-40 rounded-lg border border-zinc-800 bg-black/20 flex items-center justify-center text-xs text-zinc-500 mt-3">
                  Advert space
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}