// apps/web/src/pages/PublicProfile.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, connectSocket, registerSocketHandler } from "../lib/api";
import FeedCard from "../components/FeedCard.jsx";
import LiveActivity from "../components/LiveActivity.jsx";
import NotificationsMenu from "../components/NotificationsMenu.jsx";

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

/**
 * Normalize server responses into a single "profile" shape the UI expects.
 */
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

  // current user (for FeedCard actions / follow permissions)
  const [currentUser, setCurrentUser] = useState(null);

  // fetch current user (best-effort)
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
      `/api/profile/public-by-uid/${encodeURIComponent(idOrHandle)}`, // try uid-based lookup first (fast)
      `/api/barbers/${encodeURIComponent(idOrHandle)}`,               // then try as proId/ownerUid
      `/api/profile/pro/${encodeURIComponent(idOrHandle)}`,
      `/api/profile/public/${encodeURIComponent(idOrHandle)}`,
    ]
  : [
      `/api/profile/public/${encodeURIComponent(idOrHandle)}`, // human handles first
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
              // try loading posts separately below if none found
              payloadPosts = [];
            }
            break;
          }
        } catch (e) {
          const status = e?.response?.status;
          if (status && status !== 404) throw e;
        }
      }

      // fallback: if profile found but posts empty, hit posts endpoint
      if (payloadProfile && payloadPosts.length === 0) {
        try {
          const pid = encodeURIComponent(payloadProfile.ownerUid || payloadProfile.id || idOrHandle);
          const res = await api.get(`/api/posts?ownerUid=${pid}&limit=20`);
          payloadPosts = res?.data?.items || res?.data || [];
        } catch {
          // ignore
        }
      }

      if (payloadProfile) {
        setProfile(payloadProfile);
        setPosts(payloadPosts || []);
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

  /* -------------------------
     sockets: live profile stats (followers, metrics)
  ------------------------- */
  useEffect(() => {
    if (!profile?.ownerUid) return;
    try { connectSocket(); } catch (e) { console.warn("connectSocket failed", e?.message || e); }

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

    const unregister = typeof registerSocketHandler === "function"
      ? registerSocketHandler("profile:stats", onProfileStats)
      : null;

    return () => { try { unregister && unregister(); } catch {} };
  }, [profile?.ownerUid]);

  /* -------------------------
     follow / unfollow (optimistic)
  ------------------------- */
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

  /* -------------------------
     message / start chat
     - navigates to /chat?with=<ownerUid>
     - you can change this to open a modal or call an API to create a dedicated room
  ------------------------- */
  function startMessage() {
    if (!profile?.ownerUid) {
      alert("Cannot start chat: missing user id");
      return;
    }
    navigate(`/chat?with=${encodeURIComponent(profile.ownerUid)}`);
  }

  /* -------------------------
     helpers
  ------------------------- */
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

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white">
            {/* Cover (kept lower z so avatar can overlap) */}
      <div className="relative bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 h-44 z-10">
        {/* NotificationsMenu floating top-right (kept below avatar) */}
        <div className="absolute right-4 top-3 z-20">
          <NotificationsMenu />
        </div>
      </div>

      {/* Page container raised above cover so avatar sits on top */}
      <div className="max-w-6xl mx-auto px-4 -mt-16 relative z-30">
        <div className="flex gap-6 items-end">
          {/* Avatar wrapper: make sure z is higher than navbar (navbar is z-40).
              If your navbar still hides it, increase to z-[9999] */}
          <div className="w-32 h-32 rounded-full border-4 border-[#0b0c10] bg-zinc-900 overflow-hidden shrink-0 relative z-[9999]">
            {avatar ? (
              <img
                src={avatar}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">
                {name.slice(0, 1)}
              </div>
            )}
          </div>

          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{name}</h1>
              {badges.map((b, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-200 border border-emerald-700"
                >
                  {b}
                </span>
              ))}
            </div>

            <p className="text-sm text-zinc-400 mt-1">{location || "Nigeria"}</p>

            {rating > 0 && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                {Array.from({ length: Math.round(rating) }).map((_, i) => (
                  <span key={i} className="text-yellow-400">
                    ★
                  </span>
                ))}
                {Array.from({ length: 5 - Math.round(rating) }).map((_, i) => (
                  <span key={i} className="text-zinc-600">
                    ★
                  </span>
                ))}
                <span className="text-zinc-300 ml-1">{rating.toFixed(1)}</span>
              </div>
            )}
          </div>

          <div className="pb-3 flex gap-2">
            <a
              className="px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90"
              href={`/book/${profile.id || profile.username || idOrHandle}`}
            >
              Book now
            </a>

            <button
              className="px-4 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-200"
              title="Follow this profile"
              onClick={following ? unfollow : follow}
              disabled={followPending}
            >
              {followPending ? "…" : following ? "Unfollow" : "Follow"}
            </button>

            {/* Message button */}
            <button
              onClick={startMessage}
              className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm"
              title="Send message"
            >
              Message
            </button>
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
            ) : (
              <p className="text-sm text-zinc-400">This professional has not listed services yet.</p>
            )}
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
            ) : (
              <p className="text-sm text-zinc-400">No photos yet.</p>
            )}
          </section>

          {/* POSTS: use FeedCard for full interactive post UI */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Recent posts</h3>
            {posts.length === 0 ? (
              <p className="text-sm text-zinc-400">No posts yet.</p>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <FeedCard
                    key={p.id || p._id}
                    post={p}
                    currentUser={currentUser}
                    onDeleted={(id) => setPosts((ps) => ps.filter((x) => (x._id || x.id) !== id))}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

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

          {/* Live activity panel for this profile */}
          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-2">Live activity</h2>
            <LiveActivity ownerUid={profile.ownerUid} />
          </section>
        </div>
      </div>
    </div>
  );
}
