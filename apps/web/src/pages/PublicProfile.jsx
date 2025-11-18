// apps/web/src/pages/PublicProfile.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  api,
  getPublicProfile,
  registerSocketHandler,
  connectSocket,
} from "../lib/api";

export default function PublicProfile() {
  const { username } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPublicProfile(username);
      if (!data || !data.ok) {
        setError("Profile not found");
        setProfile(null);
        setPosts([]);
      } else {
        setProfile(data.profile || null);
        setPosts((data.posts && data.posts.items) || []);
      }
    } catch (e) {
      console.error("public profile load failed", e);
      setError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    if (username) load();
  }, [username, load]);

  useEffect(() => {
    try {
      connectSocket();
    } catch {}

    const handler = (payload) => {
      try {
        if (!payload) return;
        if (!profile) return;
        if (payload.ownerUid !== profile.ownerUid) return;
        setProfile((p) => ({
          ...(p || {}),
          metrics: { ...(p?.metrics || {}), ...(payload.metrics || {}) },
        }));
      } catch (e) {
        console.warn("profile:stats handler failed", e);
      }
    };

    const unregister = registerSocketHandler("profile:stats", handler);
    return () => {
      try {
        unregister();
      } catch {}
    };
  }, [profile]);

  if (loading)
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );

  if (error)
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-red-400">
        {error}
      </div>
    );

  if (!profile)
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-gray-400">
        No profile found
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
      <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-lg">
        <Header profile={profile} />

        <div className="p-4 sm:p-6 grid gap-6 grid-cols-1 lg:grid-cols-3">
          <div className="col-span-2 space-y-4">
            <Meta profile={profile} />
            <Posts posts={posts} />
          </div>

          <div className="space-y-4">
            <Services services={profile.services || []} />
            <Gallery gallery={profile.gallery || []} />
            <Stats profile={profile} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* HEADER */
function Header({ profile }) {
  const avatar = profile.avatarUrl || profile.avatar || "";
  const cover = profile.coverUrl || "";

  return (
    <div className="relative">
      <div className="h-40 sm:h-56 bg-black/60">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-800" />
        )}
      </div>

      <div className="px-4 sm:px-6 -mt-12 sm:-mt-16">
        <div className="flex items-end gap-4">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full ring-4 ring-black overflow-hidden bg-gray-700">
            {avatar ? (
              <img src={avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">
                {profile.displayName ? profile.displayName[0] : "P"}
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold">
                  {profile.displayName || profile.username}
                </h1>
                <div className="text-sm text-gray-400">@{profile.username}</div>
              </div>

              <FollowButton ownerUid={profile.ownerUid} />
            </div>

            <div className="mt-2 text-sm text-gray-300">{profile.bio}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* META BOX */
function Meta({ profile }) {
  return (
    <div className="rounded-lg border border-gray-800 p-4 text-sm text-gray-300">
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-400">Location</div>
          <div className="mt-1">
            {profile.lga || profile.state
              ? `${profile.lga || ""}${profile.lga && profile.state ? ", " : ""}${
                  profile.state || ""
                }`
              : "—"}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400">Rating</div>
          <div className="mt-1">
            {Number(
              profile.ratingAverage || profile.metrics?.avgRating || 0
            ).toFixed(1)}{" "}
            ⭐
          </div>
        </div>
      </div>
    </div>
  );
}

/* SERVICES */
function Services({ services }) {
  return (
    <div className="rounded-lg border border-gray-800 p-4 text-sm">
      <h3 className="font-semibold mb-2">Services</h3>
      {services.length === 0 ? (
        <div className="text-gray-400">No services listed</div>
      ) : (
        <div className="space-y-2">
          {services.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm text-gray-200"
            >
              <div>{s.name}</div>
              <div className="text-gray-300">{formatPrice(s.price)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* GALLERY */
function Gallery({ gallery }) {
  if (!gallery || gallery.length === 0)
    return (
      <div className="rounded-lg border border-gray-800 p-4 text-sm text-gray-400">
        No gallery
      </div>
    );

  return (
    <div className="rounded-lg border border-gray-800 p-4">
      <h3 className="text-sm font-semibold mb-2">Gallery</h3>
      <div className="grid grid-cols-3 gap-2">
        {gallery.slice(0, 9).map((url, i) => (
          <div key={i} className="aspect-square rounded overflow-hidden">
            <img src={url} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* STATS */
function Stats({ profile }) {
  const m = profile.metrics || {};
  return (
    <div className="rounded-lg border border-gray-800 p-4 text-sm text-center text-gray-200">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gray-400">Followers</div>
          <div className="mt-1 font-semibold">
            {Number(m.followers || profile.followersCount || 0)}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400">Posts</div>
          <div className="mt-1 font-semibold">
            {Number(profile.postsCount || m.postsCount || 0)}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400">Jobs</div>
          <div className="mt-1 font-semibold">
            {Number(profile.jobsCompleted || m.jobsCompleted || 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* POSTS */
function Posts({ posts }) {
  if (!posts || posts.length === 0)
    return <div className="text-gray-400">No posts yet</div>;

  return (
    <div className="space-y-4">
      {posts.map((p) => (
        <PostCard key={p.id || p._id} post={p} />
      ))}
    </div>
  );
}

/* POST CARD */
function PostCard({ post }) {
  const [likes, setLikes] = useState(post.stats?.likes || 0);
  const [liked, setLiked] = useState(false);
  const id = post.id || post._id;

  async function like() {
    if (liked) return;
    setLiked(true);
    setLikes((v) => v + 1);

    try {
      await api.post(`/posts/${id}/like`);
    } catch (e) {
      console.warn("like failed", e);
      setLiked(false);
      setLikes((v) => Math.max(0, v - 1));
    }
  }

  return (
    <article className="rounded-lg border border-gray-800 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-700">
          <img src={post.authorAvatar} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{post.authorName}</div>
          <div className="text-xs text-gray-400">
            {new Date(post.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-200">{post.text}</div>

      {post.media?.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {post.media.slice(0, 6).map((m, i) => (
            <div key={i} className="aspect-video rounded overflow-hidden bg-gray-800">
              <img src={m.url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-sm">
        <button
          onClick={like}
          className={`px-2 py-1 rounded ${
            liked ? "bg-green-700" : "border border-gray-700"
          }`}
        >
          ❤️ {likes}
        </button>

        <Link
          to={`/post/${id}`}
          className="px-2 py-1 rounded border border-gray-700"
        >
          Comments
        </Link>

        <button
          onClick={async () => {
            try {
              await api.post(`/posts/${id}/share`);
              alert("Shared!");
            } catch (e) {
              console.warn("share failed", e);
            }
          }}
          className="px-2 py-1 rounded border border-gray-700"
        >
          Share
        </button>
      </div>
    </article>
  );
}

/* FOLLOW BUTTON */
function FollowButton({ ownerUid }) {
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (loading) return;
    setLoading(true);
    try {
      if (!following) {
        await api.post(`/api/follow/${ownerUid}`);
        setFollowing(true);
      } else {
        await api.post(`/api/unfollow/${ownerUid}`);
        setFollowing(false);
      }
    } catch (e) {
      console.warn("follow error", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded-lg text-sm ${
        following ? "bg-green-700" : "border border-gray-700"
      }`}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

/* PRICE */
function formatPrice(n) {
  try {
    const v = Number(n || 0);
    if (v === 0) return "Free";
    return `₦${v.toLocaleString()}`;
  } catch {
    return n;
  }
}

