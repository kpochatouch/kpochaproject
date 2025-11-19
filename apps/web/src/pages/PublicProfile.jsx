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

  // fetch current user (best-effort) to check admin rights for advert rail
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

          if (data.profile) {
            payloadProfile = data.profile;
            payloadPosts = data.posts?.items || data.posts || [];
            break;
          }

          const normalized = normalizeProfile(data);
          if (normalized) {
            payloadProfile = normalized;
            if (data.posts) {
              payloadPosts = Array.isArray(data.posts) ? data.posts : data.posts.items || [];
            } else if (data._posts) {
              payloadPosts = Array.isArray(data._posts) ? data._posts : [];
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

  /* sockets: live profile stats (followers, metrics) */
  useEffect(() => {
    if (!profile?.ownerUid) return;
    try { connectSocket(); } catch (e) { console.warn("connectSocket failed", e?.message || e); }

    const applyStats = (payload) => {
      try {
        if (!payload) return;
        const ownerUid = payload.ownerUid ?? payload.targetUid ?? payload.target?.uid ?? null;
        if (!ownerUid || ownerUid !== profile.ownerUid) return;
        const followers = payload.followersCount ?? payload.followers ?? payload.followersCount ?? (payload.followers || null);
        setProfile((p) => ({
          ...(p || {}),
          metrics: { ...(p?.metrics || {}), followers: followers ?? p?.metrics?.followers },
          followersCount: followers ?? p?.followersCount ?? p?.metrics?.followers,
        }));
      } catch (err) {
        console.warn("applyStats failed", err?.message || err);
      }
    };

    const unregisterStats = typeof registerSocketHandler === "function"
      ? registerSocketHandler("profile:stats", (p) => applyStats(p))
      : null;

    const unregisterFollow = typeof registerSocketHandler === "function"
      ? registerSocketHandler("profile:follow", (p) => applyStats(p))
      : null;

    return () => {
      try { unregisterStats && unregisterStats(); } catch {}
      try { unregisterFollow && unregisterFollow(); } catch {}
    };
  }, [profile?.ownerUid]);

  /* follow / unfollow (optimistic) */
  useEffect(() => {
    if (!profile?.ownerUid) return;
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
    setProfile((p) => ({
      ...(p || {}),
      followersCount: (p?.followersCount || 0) + 1,
      metrics: { ...(p?.metrics || {}), followers: (p?.metrics?.followers || 0) + 1 },
    }));
    try {
      const { data } = await api.post(`/api/follow/${encodeURIComponent(profile.ownerUid)}`);
      setProfile((p) => ({
        ...(p || {}),
        followersCount: data?.followers ?? p?.followersCount,
        metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers },
      }));
    } catch (e) {
      console.error("follow failed", e);
      setFollowing(false);
      setProfile((p) => ({
        ...(p || {}),
        followersCount: Math.max(0, (p?.followersCount || 1) - 1),
        metrics: { ...(p?.metrics || {}), followers: Math.max(0, (p?.metrics?.followers || 1) - 1) },
      }));
    } finally {
      setFollowPending(false);
    }
  }

  async function unfollow() {
    if (!profile?.ownerUid || followPending) return;
    setFollowPending(true);
    setFollowing(false);
    setProfile((p) => ({
      ...(p || {}),
      followersCount: Math.max(0, (p?.followersCount || 1) - 1),
      metrics: { ...(p?.metrics || {}), followers: Math.max(0, (p?.metrics?.followers || 1) - 1) },
    }));
    try {
      const { data } = await api.delete(`/api/follow/${encodeURIComponent(profile.ownerUid)}`);
      setProfile((p) => ({
        ...(p || {}),
        followersCount: data?.followers ?? p?.followersCount,
        metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers },
      }));
    } catch (e) {
      console.error("unfollow failed", e);
      setFollowing(true);
      setProfile((p) => ({
        ...(p || {}),
        followersCount: (p?.followersCount || 0) + 1,
        metrics: { ...(p?.metrics || {}), followers: (p?.metrics?.followers || 0) + 1 },
      }));
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
        if (append) {
          setLoadingMore(true);
        } else {
          setLoadingPosts(true);
        }
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

  // attach observer when profile is set and feed tab (profile page always shows posts)
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
              // compute cursor as last post's createdAt or _id
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
    if (!profile?.ownerUid) return;
    // initial posts fetch handled by fetchProfile -> payload; also call fetchPosts to ensure pagination works
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
      <div className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 pb-10">
        <div className="lg:col-span-2 space-y-6">
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

        {/* RIGHT ADS + stats */}
        <div className="space-y-6">
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
                        // refresh posts (also shows as feed item on global feed)
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
  );
}
