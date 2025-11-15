// apps/web/src/pages/PublicProfile.jsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

export default function PublicProfile() {
  const { id } = useParams(); // route: /profile/:id
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [err, setErr] = useState("");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const isLikelyUid =
        typeof id === "string" && (id.length > 20 || /^[0-9a-fA-F]{24}$/.test(id));

      // prefer fast pro-by-id route first
      const candidates = isLikelyUid
        ? [
            `/api/barbers/${encodeURIComponent(id)}`,
            `/api/profile/public-by-uid/${encodeURIComponent(id)}`,
            `/api/profile/pro/${encodeURIComponent(id)}`,
            `/api/profile/public/${encodeURIComponent(id)}`,
          ]
        : [
            `/api/profile/public/${encodeURIComponent(id)}`,
            `/api/profile/pro/${encodeURIComponent(id)}`,
            `/api/profile/public-by-uid/${encodeURIComponent(id)}`,
          ];

      let payload = null;
      for (const path of candidates) {
        try {
          const resp = await api.get(path);
          const data = resp?.data ?? null;

          // server might return { ok:true, profile, posts } or profile/pro doc directly
          if (data && data.profile) {
            payload = data;
            break;
          }
          if (data && (data.displayName || data.ownerUid || data.username || data.name)) {
            // normalize a pro/doc shape into { profile, posts }
            // if server returned a pro doc (barber) use it as profile-like doc
            const profileDoc = {
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
              followersCount: data.metrics?.followers || data.followersCount || 0,
              postsCount: data.metrics?.postsCount || data.postsCount || 0,
              jobsCompleted: data.metrics?.jobsCompleted || data.jobsCompleted || 0,
              ratingAverage: data.metrics?.avgRating || data.rating || 0,
              id: data._id || data.id || undefined,
            };
            payload = { profile: profileDoc, posts: data.posts ? { items: data.posts } : { items: [] } };
            break;
          }
        } catch (err) {
          const status = err?.response?.status;
          // on non-404 error bubble up
          if (status && status !== 404) throw err;
          // otherwise try next candidate
        }
      }

      if (payload && payload.profile) {
        setProfile(payload.profile);
        setPosts(payload.posts?.items || []);
      } else {
        setProfile(null);
        setPosts([]);
        setErr("Profile not found.");
      }
    } catch (err) {
      console.error("public profile load:", err);
      setProfile(null);
      setPosts([]);
      setErr("Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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
            <a className="px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90" href={`/book/${profile.id || id}`}>Book now</a>
            <button className="px-4 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-200" disabled title="Contact details appear after booking">Contact via booking</button>
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
            <h2 className="text-lg font-semibold mb-2">Booking</h2>
            <p className="text-sm text-zinc-400 mb-3">To view contact details, make a booking. We hide private contact from the public to keep your pros & clients safe.</p>
            <a className="inline-block px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90" href={`/book/${profile.id || id}`}>Book this pro →</a>
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
          <article key={p.id} className="mb-3 p-3 rounded border border-zinc-800 bg-black/20">
            <div className="text-sm mb-2">{p.text}</div>
            {p.media && p.media.length > 0 && <div className="flex gap-2">{p.media.slice(0,4).map((m,i)=>(<img key={i} src={m.url || m} className="w-28 h-20 object-cover rounded" alt="" />))}</div>}
            <div className="text-xs text-zinc-500 mt-2">{formatDate(p.createdAt)} • {p.stats?.views ?? 0} views • {p.stats?.likes ?? 0} likes</div>
          </article>
        ))}
      </div>
    </div>
  );
}
