import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicProfile,
  connectSocket,
  registerSocketHandler,
  api,
  setAuthToken,
} from "../lib/api";

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

export default function PublicProfile() {
  const { username } = useParams();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState(0); // optional
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  const fetchProfile = useCallback(async () => {
  setLoading(true);
  try {
    const isLikelyUid =
      typeof username === "string" &&
      (username.length > 20 || /^[0-9a-fA-F]{24}$/.test(username));

    // candidate endpoints in preferred order
    const candidates = isLikelyUid
      ? [
          `/api/profile/public-by-uid/${encodeURIComponent(username)}`,
          `/api/profile/pro/${encodeURIComponent(username)}`,
          `/api/profile/public/${encodeURIComponent(username)}`,
        ]
      : [
          `/api/profile/public/${encodeURIComponent(username)}`,
          `/api/profile/pro/${encodeURIComponent(username)}`,
        ];

    let payload = null;
    for (const path of candidates) {
      try {
        console.debug("[public profile] trying", path);
        const resp = await api.get(path);
        const data = resp?.data ?? null;

        // server might return { ok:true, profile, posts } or profile directly
        if (data && data.profile) {
          payload = data;
          break;
        }

        // also accept if server returned profile object directly
        if (data && (data.displayName || data.ownerUid || data.username)) {
          payload = { profile: data, posts: data.posts || { items: [] } };
          break;
        }
      } catch (err) {
        const status = err?.response?.status;
        console.warn(`[public profile] ${path} -> ${status || "err"}`, err?.message);
        // only bail on non-404 errors
        if (status && status !== 404) throw err;
        // otherwise try next candidate
      }
    }

    if (payload && payload.profile) {
      setProfile(payload.profile);
      setPosts(payload.posts?.items || payload.posts || []);
    } else {
      setProfile(null);
      setPosts([]);
    }
  } catch (err) {
    console.error("public profile load:", err);
    setProfile(null);
    setPosts([]);
  } finally {
    setLoading(false);
  }
}, [username]);



  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  /* -------------------------
     socket + live follower updates
     ------------------------- */
  useEffect(() => {
    if (!profile?.ownerUid) return;

    // handler reacts to profile:stats events coming from server
    const onProfileStats = (payload) => {
      try {
        if (!payload || payload.ownerUid !== profile.ownerUid) return;
        setProfile((p) => ({
          ...(p || {}),
          // update both metrics and top-level followersCount (keeps UI consistent)
          metrics: { ...(p?.metrics || {}), followers: payload.followersCount ?? p?.metrics?.followers },
          followersCount: payload.followersCount ?? p?.followersCount ?? p?.metrics?.followers,
        }));
      } catch (e) {
        console.warn("profile stats handler failed", e?.message || e);
      }
    };

    // ensure socket is connected and register handler
    try {
      connectSocket(); // idempotent
    } catch (e) {
      console.warn("connectSocket failed:", e?.message || e);
    }

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
        // GET /api/follow/:uid/status
        const { data } = await api.get(
          `/api/follow/${encodeURIComponent(profile.ownerUid)}/status`
        );
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
     follow / unfollow actions
     ------------------------- */
  async function follow() {
    if (!profile?.ownerUid) return;
    setFollowPending(true);
    try {
      const { data } = await api.post(
        `/api/follow/${encodeURIComponent(profile.ownerUid)}`
      );
      setFollowing(true);
      setProfile((p) => ({
        ...(p || {}),
        followersCount:
          data?.followers ?? p?.followersCount ?? (p?.metrics?.followers || 0),
        metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers },
      }));
    } catch (err) {
      console.error("follow failed", err);
    } finally {
      setFollowPending(false);
    }
  }


    async function unfollow() {
    if (!profile?.ownerUid) return;
    setFollowPending(true);
    try {
      const { data } = await api.delete(
        `/api/follow/${encodeURIComponent(profile.ownerUid)}`
      );
      setFollowing(false);
      setProfile((p) => ({
        ...(p || {}),
        followersCount:
          data?.followers ?? p?.followersCount ?? (p?.metrics?.followers || 0),
        metrics: { ...(p?.metrics || {}), followers: data?.followers ?? p?.metrics?.followers },
      }));
    } catch (err) {
      console.error("unfollow failed", err);
    } finally {
      setFollowPending(false);
    }
  }



  if (loading) return <div>Loading profile…</div>;
  if (!profile) return <div>Profile not found</div>;

  return (
    <div className="public-profile p-4">
      <div className="profile-hero mb-4">
        <img
          src={profile.coverUrl || "/menu/bg-home.png"}
          alt="cover"
          style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 8 }}
        />
        <div style={{ display: "flex", alignItems: "center", marginTop: -40 }}>
          <img
            src={profile.avatarUrl || "/menu/logo.svg"}
            alt="avatar"
            style={{ width: 80, height: 80, borderRadius: 40, border: "3px solid white" }}
          />
          <div style={{ marginLeft: 12 }}>
            <h2 style={{ margin: 0 }}>{profile.displayName || profile.username}</h2>
            <div style={{ fontSize: 13, color: "#666" }}>
              {profile.isPro ? "Professional" : "Member"} • {profile.services?.length ? `${profile.services.length} services` : ""}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            {followPending ? (
              <button disabled>…</button>
            ) : following ? (
              <button onClick={unfollow}>Unfollow</button>
            ) : (
              <button onClick={follow}>Follow</button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
          <div><strong>{profile.metrics?.followers ?? profile.followersCount ?? 0}</strong> followers</div>
          <div><strong>{profile.postsCount ?? 0}</strong> posts</div>
          <div><strong>{profile.jobsCompleted ?? 0}</strong> completed</div>
          <div><strong>{profile.ratingAverage ?? 0}</strong> rating</div>
        </div>
      </div>

      <section className="bio mb-4">
        <p>{profile.bio}</p>
      </section>

      <section className="posts">
        <h3>Recent posts</h3>
        {posts.length === 0 ? <p>No posts yet</p> : posts.map((p) => (
          <article key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>{p.text}</div>
            {p.media && p.media.length > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                {p.media.slice(0, 4).map((m, i) => (
                  <img key={i} src={m.url || m.thumbnailUrl || m} style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 6 }} />
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              {formatDate(p.createdAt)} • {p.stats?.views ?? 0} views • {p.stats?.likes ?? 0} likes • {p.stats?.comments ?? 0} comments
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
