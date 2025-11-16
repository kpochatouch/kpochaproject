// apps/web/src/pages/PublicProfile.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  connectSocket,
  registerSocketHandler,
  api,
} from "../lib/api";

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

/**
 * Normalize server responses into a single "profile" shape the UI expects.
 * Accepts either a profile doc or a barber/pro doc.
 */
function normalizeProfile(data) {
  if (!data) return null;
  // If server already returned a profile wrapper
  if (data.profile) return data.profile;

  // If it's a "profile-like" doc already
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
      // if server included posts in the doc
      _posts: data.posts || null,
    };
  }

  return null;
}

export default function PublicProfile() {
  // route param may be username or id. app routes: /profile/:id or /profile/:username
  const { username: routeParam } = useParams();
  const idOrHandle = routeParam;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [err, setErr] = useState("");
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const isLikelyUid =
        typeof idOrHandle === "string" &&
        (idOrHandle.length > 20 || /^[0-9a-fA-F]{24}$/.test(idOrHandle));

      const candidates = isLikelyUid
        ? [
            `/api/barbers/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/public-by-uid/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/pro/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/public/${encodeURIComponent(idOrHandle)}`,
          ]
        : [
            `/api/profile/public/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/pro/${encodeURIComponent(idOrHandle)}`,
            `/api/profile/public-by-uid/${encodeURIComponent(idOrHandle)}`,
          ];

      let payloadProfile = null;
      let payloadPosts = [];

      for (const path of candidates) {
        try {
          const resp = await api.get(path);
          const data = resp?.data ?? null;
          if (!data) continue;

          // If server returned wrapper { profile, posts }
          if (data.profile) {
            payloadProfile = data.profile;
            payloadPosts = data.posts?.items || data.posts || [];
            break;
          }

          // If server returned profile-like object or pro doc, normalize
          const normalized = normalizeProfile(data);
          if (normalized) {
            payloadProfile = normalized;
            // try collecting posts from doc if present
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
          // only abort on non-404 errors
          if (status && status !== 404) throw e;
          // else try next candidate
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
     socket: live profile stats (followers, metrics)
  ------------------------- */
  useEffect(() => {
    if (!profile?.ownerUid) return;
    // idempotent connect
    try {
      connectSocket();
    } catch (e) {
      console.warn("connectSocket failed", e?.message || e);
    }

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

    return () => {
      try {
        unregister && unregister();
      } catch (e) {
        console.warn("unregister failed", e?.message || e);
      }
    };
  }, [profile?.ownerUid]);

  /* -------------------------
     initial follow state loader
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
    return () => {
      alive = false;
    };
  }, [profile?.ownerUid]);

  /* -------------------------
     follow / unfollow actions (optimistic)
  ------------------------- */
  async function follow() {
    if (!profile?.ownerUid || followPending) return;
    setFollowPending(true);
    // optimistic update
    setFollowing(true);
    setProfile((p) => ({
      ...(p || {}),
      followersCount: (p?.followersCount || 0) + 1,
      metrics: { ...(p?.metrics || {}), followers: (p?.metrics?.followers || 0) + 1 },
    }));
    try {
      const { data } = await api.post(`/api/follow/${encodeURIComponent(profile.ownerUid)}`);
      // reconcile with server response if available
      setProfile((p) => ({
        ...(p || {}),
        followersCount: data?.followers ?? p?.followersCount,
        metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers },
      }));
    } catch (e) {
      console.error("follow failed", e);
      // rollback
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
    // optimistic update
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
      // rollback
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
      <div className="relative bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 h-44" />
      <div className="max-w-6xl mx-auto px-4 -mt-16">
        <div className="flex gap-6 items-end">
          <div className="w-32 h-32 rounded-full border-4 border-[#0b0c10] bg-zinc-900 overflow-hidden shrink-0">
            {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl">{name.slice(0,1)}</div>}
          </div>
          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{name}</h1>
              {badges.map((b, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-200 border border-emerald-700">{b}</span>
              ))}
            </div>
            <p className="text-sm text-zinc-400 mt-1">{location || "Nigeria"}</p>
            {rating > 0 && <div className="flex items-center gap-1 mt-2 text-sm">{Array.from({ length: Math.round(rating) }).map((_,i)=> <span key={i} className="text-yellow-400">★</span>)}{Array.from({ length: 5 - Math.round(rating) }).map((_,i)=> <span key={i} className="text-zinc-600">★</span>)}<span className="text-zinc-300 ml-1">{rating.toFixed(1)}</span></div>}
          </div>
          <div className="pb-3 flex gap-2">
            <a className="px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90" href={`/book/${profile.id || profile.username || idOrHandle}`}>Book now</a>

            <button
              className="px-4 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-200"
              title="Follow this profile"
              onClick={following ? unfollow : follow}
              disabled={followPending}
            >
              {followPending ? "…" : following ? "Unfollow" : "Follow"}
            </button>
          </div>
        </div>
      </div>

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
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-2">Stats</h2>
            <div className="text-sm text-zinc-200">
              <div><strong>{profile.followersCount ?? profile.metrics?.followers ?? 0}</strong> followers</div>
              <div><strong>{profile.postsCount ?? 0}</strong> posts</div>
              <div><strong>{profile.jobsCompleted ?? 0}</strong> completed</div>
              <div><strong>{profile.ratingAverage ?? 0}</strong> rating</div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-2">Location</h2>
            <p className="text-sm text-zinc-200">{location || "Nigeria"}</p>
          </section>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-10">
        <h3 className="text-lg font-semibold mb-3">Recent posts</h3>
        {posts.length === 0 ? <p className="text-sm text-zinc-400">No posts yet.</p> : posts.map((p) => (
          <article key={p.id || p._id} className="mb-3 p-3 rounded border border-zinc-800 bg-black/20">
            <div className="text-sm mb-2">{p.text}</div>
            {p.media && p.media.length > 0 && <div className="flex gap-2">{p.media.slice(0,4).map((m,i)=>(<img key={i} src={m.url || m} className="w-28 h-20 object-cover rounded" alt="" />))}</div>}
            <div className="text-xs text-zinc-500 mt-2">{formatDate(p.createdAt)} • {p.stats?.views ?? 0} views • {p.stats?.likes ?? 0} likes</div>
          </article>
        ))}
      </div>
    </div>
  );
}
