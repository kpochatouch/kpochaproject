import express from "express";
import admin from "../lib/firebaseAdmin.js";
import { ClientProfile, ProProfile } from "../models/Profile.js";
import { Booking } from "../models/Booking.js";
import { Pro } from "../models.js";
import mongoose from "mongoose";

// new helpers for public profile, caching and realtime
import redisClient from "../redis.js";
import Post from "../models/Post.js";
import PostStats from "../models/PostStats.js";
import { proToBarber } from "../models.js";
import { getIO } from "../sockets/index.js";
import { requireAuth, tryAuth, requireAdmin, isAdminUser } from "../lib/auth.js";


const router = express.Router();


/* ------------------------------------------------------------------
   UTILS
   ------------------------------------------------------------------ */
function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function maskClientProfileForClientView(p) {
  if (!p) return null;
  const obj = { ...p };
  delete obj.ownerUid;
  delete obj.uid;
  if (obj.id?.numberHash) obj.id.numberHash = "****";
  return obj;
}

function filterProPublic(p) {
  if (!p) return null;
  return {
    proId: p.proId?.toString?.() || p.proId,
    shopAddress: p.shopAddress || "",
    shopPhone: p.shopPhone || "",
    whatsapp: p.whatsapp || "",
    bio: p.bio || "",
    gallery: Array.isArray(p.gallery) ? p.gallery : [],
    verified: !!p.verified,
  };
}

function buildProfilesSetFromPayload(payload = {}) {
  const set = {};
  if (payload.fullName) set.fullName = payload.fullName;
  if (payload.phone) set.phone = payload.phone;
  if (payload.state) set.state = String(payload.state).toUpperCase();
  if (payload.lga) set.lga = String(payload.lga).toUpperCase();
  if (payload.address) set.address = payload.address;
  if (payload.photoUrl) set.photoUrl = payload.photoUrl;
  if (payload.identity && typeof payload.identity === "object") {
    set.identity = payload.identity;
    if (payload.identity.photoUrl) set.photoUrl = payload.identity.photoUrl;
  }
  if (payload.kyc) set.kyc = payload.kyc;
  if (typeof payload.acceptedTerms === "boolean")
    set.acceptedTerms = payload.acceptedTerms;
  if (typeof payload.acceptedPrivacy === "boolean")
    set.acceptedPrivacy = payload.acceptedPrivacy;
  if (payload.agreements) set.agreements = payload.agreements;
  return set;
}

// ✅ only these fields should force “verify today”
function bodyTouchesSensitiveClient(body = {}) {
  if (!body || typeof body !== "object") return false;
  // Only truly sensitive on CLIENT profile:
  // - identity/KYC bundle (IDs, real-name proofs, ID photos, etc.)
  // If you want address to be sensitive, uncomment the next line.
  if (body.identity) return true;
  // if (body.address) return true;
  return false;
}


// ✅ allow frontend to tell us “I just did liveness, remember it”
async function rememberLivenessToday(uid) {
  try {
    const col = mongoose.connection.db.collection("profiles");
    await col.updateOne(
      { uid },
      { $set: { livenessVerifiedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.warn("[profile:liveness:remember] skipped:", e?.message || e);
  }
}

/* ------------------------------------------------------------------
   1) ENSURE PROFILE (this is the ONLY one allowed to CREATE)
   ------------------------------------------------------------------ */
router.post("/profile/ensure", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    if (!uid) return res.status(400).json({ error: "missing_uid" });

    const existing = await ClientProfile.findOne({ uid }).lean();

    if (!existing) {
      const base = {
        uid,
        fullName: (req.user.email || "").split("@")[0] || "",
      };
      await ClientProfile.create(base);

      try {
        const col = mongoose.connection.db.collection("profiles");
        await col.updateOne(
          { uid },
          {
            $set: {
              uid,
              fullName: base.fullName,
            },
          },
          { upsert: true }
        );
      } catch (e) {
        console.warn("[profile:ensure] raw sync skipped:", e?.message || e);
      }

      return res.json({ ok: true, created: true });
    }

    // sync raw
    try {
      const col = mongoose.connection.db.collection("profiles");
      await col.updateOne(
        { uid },
        {
          $set: {
            uid,
            fullName: existing.fullName || "",
            phone: existing.phone || "",
            state: existing.state || "",
            lga: existing.lga || "",
            address: existing.address || "",
            photoUrl: existing.photoUrl || "",
            ...(existing.identity ? { identity: existing.identity } : {}),
            ...(existing.livenessVerifiedAt
              ? { livenessVerifiedAt: existing.livenessVerifiedAt }
              : {}),
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.warn("[profile:ensure-existing] raw sync skipped:", e?.message || e);
    }

    return res.json({ ok: true, created: false });
  } catch (e) {
    console.warn("[profile:ensure] error", e?.message || e);
    return res.status(500).json({ error: "ensure_failed" });
  }
});

/* ------------------------------------------------------------------
   2) CLIENT PROFILE - GET
   ------------------------------------------------------------------ */
async function handleGetClientMe(req, res) {
  try {
    const p = await ClientProfile.findOne({ uid: req.user.uid }).lean();

    const pro = await Pro.findOne({ ownerUid: req.user.uid })
      .select("_id name photoUrl status")
      .lean()
      .catch(() => null);

    const masked = maskClientProfileForClientView(p) || {};

    return res.json({
      ...masked,
      email: req.user.email || "",
      // expose liveness to frontend so it can decide to reopen AWS
      livenessVerifiedAt: p?.livenessVerifiedAt || null,
      pro: pro
        ? {
            id: pro._id.toString(),
            name: pro.name || "",
            status: pro.status || "approved",
            photoUrl: pro.photoUrl || "",
          }
        : null,
    });
  } catch (e) {
    console.warn("[profile:get/me] error", e?.message || e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
}

/* ------------------------------------------------------------------
   3) CLIENT PROFILE - UPDATE ONLY (no create here)
   ------------------------------------------------------------------ */
async function handlePutClientMe(req, res) {
  try {
    const uid = req.user.uid;
    const payload = req.body || {};

    // load current profile to check liveness + existing values
    const existing = await ClientProfile.findOne({ uid }).lean();

    if (!existing) {
      return res.status(404).json({ error: "profile_not_found" });
    }

    // did frontend just tell us to remember?
    const wantsRemember =
      payload.liveness && payload.liveness.remember === true;

    if (wantsRemember) {
      await rememberLivenessToday(uid);
    }

    // do we need liveness for THIS payload?
    const touchesSensitive = bodyTouchesSensitiveClient(payload);

    // what do we currently have on record?
    const verifiedToday = existing.livenessVerifiedAt
      ? isSameDay(existing.livenessVerifiedAt, new Date())
      : false;

    // if they touch sensitive AND we don't have today AND they didn't just send remember → block
    if (touchesSensitive && !verifiedToday && !wantsRemember) {
      return res.status(403).json({ error: "liveness_required" });
    }

    // normalize casing only if present
    if (payload.lga) payload.lga = String(payload.lga).toUpperCase();
    if (payload.state) payload.state = String(payload.state).toUpperCase();

    const clientSet = { uid };

    if (payload.fullName && payload.fullName.trim()) {
      clientSet.fullName = payload.fullName.trim();
      clientSet.displayName = payload.fullName.trim();
    }
    if (payload.phone && payload.phone.trim()) {
      clientSet.phone = payload.phone.trim();
    }
    if (payload.state) {
      clientSet.state = payload.state;
    }
    if (payload.lga) {
      clientSet.lga = payload.lga;
    }
    if (typeof payload.address === "string" && payload.address.trim()) {
      clientSet.address = payload.address.trim();
    }
    if (payload.photoUrl && payload.photoUrl.trim()) {
      clientSet.photoUrl = payload.photoUrl.trim();
    }
    if (payload.identity && typeof payload.identity === "object") {
      clientSet.identity = payload.identity;
      if (payload.identity.photoUrl && payload.identity.photoUrl.trim()) {
        clientSet.photoUrl = payload.identity.photoUrl.trim();
      }
    }
    if (payload.kyc) clientSet.kyc = payload.kyc;
    if (typeof payload.acceptedTerms === "boolean")
      clientSet.acceptedTerms = payload.acceptedTerms;
    if (typeof payload.acceptedPrivacy === "boolean")
      clientSet.acceptedPrivacy = payload.acceptedPrivacy;
    if (payload.agreements) clientSet.agreements = payload.agreements;

    const updated = await ClientProfile.findOneAndUpdate(
      { uid },
      { $set: clientSet },
      { new: true }
    ).lean();

    // sync raw "profiles" collection
    try {
      const col = mongoose.connection.db.collection("profiles");
      const $set = {
        uid,
      };

      const fromPayload = buildProfilesSetFromPayload(payload);
      Object.assign($set, fromPayload);

      // keep the old stamp, or write a new one if they said remember
      if (wantsRemember) {
        $set.livenessVerifiedAt = new Date();
      } else if (existing.livenessVerifiedAt) {
        $set.livenessVerifiedAt = existing.livenessVerifiedAt;
      }

      await col.updateOne({ uid }, { $set }, { upsert: true });
    } catch (e) {
      console.warn("[profile->profiles col sync] skipped:", e?.message || e);
    }

    // sync to Pro doc too (your original behavior)
    try {
      const pro = await Pro.findOne({ ownerUid: uid }).select("_id").lean();
      if (pro) {
        const proSet = {};

        if (payload.fullName && payload.fullName.trim()) {
          proSet.name = payload.fullName.trim();
        }
        if (payload.phone && payload.phone.trim()) {
          proSet.phone = payload.phone.trim();
        }
        if (payload.photoUrl && payload.photoUrl.trim()) {
          proSet.photoUrl = payload.photoUrl.trim();
        } else if (
          payload.identity &&
          typeof payload.identity === "object" &&
          payload.identity.photoUrl &&
          payload.identity.photoUrl.trim()
        ) {
          proSet.photoUrl = payload.identity.photoUrl.trim();
        }
        if (payload.state) {
          proSet.state = payload.state;
        }
        if (payload.lga) {
          proSet.lga = payload.lga;
        }

        if (Object.keys(proSet).length > 0) {
          await Pro.updateOne({ ownerUid: uid }, { $set: proSet });
        }
      }
    } catch (e) {
      console.warn("[profile->pro sync] skipped:", e?.message || e);
    }

    // invalidate public cache for this username (if profile has username)
try {
  const usernameToInvalidate = (updated && updated.username) || (payload && payload.username);
  if (redisClient && usernameToInvalidate) {
    const key = `public:profile:${String(usernameToInvalidate).toLowerCase()}`;
    await redisClient.del(key);
  }
} catch (err) {
  console.warn("[public/profile] invalidate after client update failed:", err?.message || err);
}

// immediate socket notify (optional but recommended)
try {
  const io = getIO();
  io.to(`profile:${updated.uid}`).emit("profile:stats", { ownerUid: updated.uid });
} catch (err) {
  console.warn("[public/profile] socket emit after client update failed:", err?.message || err);
}


    const masked = maskClientProfileForClientView(updated) || {};
    return res.json({
      ...masked,
      email: req.user.email || "",
      // return the latest known stamp
      livenessVerifiedAt: wantsRemember
        ? new Date()
        : existing.livenessVerifiedAt || null,
    });
  } catch (e) {
    console.warn("[profile:put/me] error", e?.message || e);
    return res.status(500).json({ error: "Failed to save profile" });
  }
}

/* ------------------------------------------------------------------
   REGISTER ROUTES
   ------------------------------------------------------------------ */
router.get("/profile/client/me", requireAuth, handleGetClientMe);
router.put("/profile/client/me", requireAuth, handlePutClientMe);
// aliases kept
router.get("/profile/me", requireAuth, handleGetClientMe);
router.put("/profile/me", requireAuth, handlePutClientMe);

/* ------------------------------------------------------------------
   PUBLIC PROFILE - READ-ONLY PROJECTION (public)
   GET /profile/public/:username
   ------------------------------------------------------------------ */
const PUBLIC_PROFILE_CACHE_SEC = Number(process.env.PUBLIC_PROFILE_CACHE_SEC || 60);

async function handleGetPublicProfile(req, res) {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "username_required" });

    const cacheKey = `public:profile:${username.toLowerCase()}`;

    // Try Redis cache first
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      } catch (e) {
        console.warn("[public/profile] redis get failed:", e?.message || e);
      }
    }

    // 1) Client profile by username (client profile is canonical for username)
    const client = await ClientProfile.findOne({ username }).lean();
    if (!client) return res.status(404).json({ error: "profile_not_found" });

    const ownerUid = client.uid; // your file uses uid for client

    // 2) Pro doc if exists
    const pro = await Pro.findOne({ ownerUid }).lean().catch(() => null);
    const publicFromPro = pro ? proToBarber(pro) : null;

    // 3) Merge identity fields (client is primary for identity)
    const profilePublic = {
      ownerUid,
      username: client.username || (publicFromPro && publicFromPro.id) || username,
      displayName: client.displayName || client.fullName || (publicFromPro && publicFromPro.name) || "",
      avatarUrl: client.photoUrl || (publicFromPro && publicFromPro.photoUrl) || "",
      coverUrl: client.coverUrl || (pro?.coverUrl || ""),
      bio: client.bio || (pro?.bio || "") || "",
      isPro: Boolean(pro),
      services: (publicFromPro && publicFromPro.services) || [],
      gallery: (publicFromPro && publicFromPro.gallery) || (client.gallery || []),
      contactPublic: (pro && pro.contactPublic) || {},
      badges: (publicFromPro && publicFromPro.badges) || [],
      metrics: (pro && pro.metrics) || {},
      followersCount: 0,
      postsCount: 0,
      jobsCompleted: 0,
      ratingAverage: Number((pro && pro.metrics && pro.metrics.avgRating) || 0),
    };

    // 4) Counts: prefer pro.metrics, fall back to client or aggregate
profilePublic.followersCount = Number(pro?.metrics?.followers || client.followersCount || 0);

// TOLERANT posts count: accept different historical field shapes
try {
  profilePublic.postsCount = await Post.countDocuments({
    $and: [
      { isPublic: true, hidden: { $ne: true }, deleted: { $ne: true } },
      {
        $or: [
          { proOwnerUid: ownerUid },
          { ownerUid: ownerUid },
          { proUid: ownerUid },
          { createdBy: ownerUid },
        ],
      },
    ],
  });
} catch (e) {
  profilePublic.postsCount = Number(pro?.metrics?.postsCount || 0);
}


// JOBS COMPLETED: try to use pro.metrics first, else count bookings.
// we attempt a few common field shapes so this is resilient to schema variations.
if (pro?.metrics?.jobsCompleted) {
  profilePublic.jobsCompleted = Number(pro.metrics.jobsCompleted || 0);
} else {
  try {
    const bookingQueryOr = [
      { proOwnerUid: ownerUid },
      { proUid: ownerUid },
    ];
    // if we have a pro._id (ObjectId) include matching proId clause
    if (pro && pro._id) {
      try {
        bookingQueryOr.push({ proId: new mongoose.Types.ObjectId(pro._id) });
      } catch {}
    }

    profilePublic.jobsCompleted = await Booking.countDocuments({
      $and: [{ status: "completed" }, { $or: bookingQueryOr }],
    });
  } catch (e) {
    profilePublic.jobsCompleted = 0;
  }
}

if (pro?.metrics?.avgRating) {
  profilePublic.ratingAverage = Number(pro.metrics.avgRating);
}


    // 5) Recent public posts (small page)
// use canonical Post fields: proOwnerUid + isPublic, exclude hidden/deleted
const postsRaw = await Post.find({
  proOwnerUid: ownerUid,
  isPublic: true,
  hidden: { $ne: true },
  deleted: { $ne: true },
})
  .sort({ createdAt: -1 })
  .limit(10)
  .lean();


    // Enrich posts with PostStats
    const pIds = postsRaw.map((p) => p._id?.toString()).filter(Boolean);
    let statsMap = {};
    if (pIds.length && PostStats) {
      const stats = await PostStats.find({ postId: { $in: pIds } }).lean().catch(() => []);
      statsMap = stats.reduce((acc, s) => {
        acc[String(s.postId)] = s;
        return acc;
      }, {});
    }

    const publicPosts = postsRaw.map((p) => {
  const s = statsMap[String(p._id)] || {};
  return {
    id: p._id?.toString?.() || String(p._id),
    proOwnerUid: p.proOwnerUid || "",      // <-- standard field name
    proId: p.proId ? String(p.proId) : null,
    text: p.text,
    media: p.media || [],
    createdAt: p.createdAt,
    stats: {
      likes: Number(s.likesCount || s.likes || 0),
      comments: Number(s.commentsCount || s.comments || 0),
      shares: Number(s.sharesCount || s.shares || 0),
      views: Number(s.viewsCount || s.views || 0),
    },
  };
});



    const payload = { ok: true, profile: profilePublic, posts: { items: publicPosts, cursor: null } };

    // Cache payload
    if (redisClient) {
      try {
        await redisClient.setEx(cacheKey, PUBLIC_PROFILE_CACHE_SEC, JSON.stringify(payload));
      } catch (e) {
        console.warn("[public/profile] redis set failed:", e?.message || e);
      }
    }

    return res.json(payload);
  } catch (e) {
    console.error("[public/profile] err:", e?.stack || e);
    return res.status(500).json({ error: "server_error" });
  }
}

router.get("/profile/public/:username", handleGetPublicProfile);

// GET public profile by UID (useful when frontend links by uid)
router.get("/profile/public-by-uid/:uid", async (req, res) => {
  try {
    const uid = String(req.params.uid || "").trim();
    if (!uid) return res.status(400).json({ error: "uid_required" });

    const cacheKey = `public:profile:uid:${uid}`;

    // try redis cache first
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.status(200).json(JSON.parse(cached));
      } catch (e) {
        console.warn("[public/profile-by-uid] redis get failed:", e?.message || e);
      }
    }

    // 1) client profile by uid (fall back to Pro if no ClientProfile exists)
let client = await ClientProfile.findOne({ uid }).lean();

if (!client) {
  // try to build a client-like object from the Pro doc so public profile still works
  const pro = await Pro.findOne({ ownerUid: uid }).lean().catch(() => null);
  if (!pro) {
    // neither client nor pro found — original behaviour
    return res.status(404).json({ error: "profile_not_found" });
  }

  // build a client-like object (minimal fields used later)
  client = {
    uid: uid,
    username: pro.username || pro.handle || "",
    displayName: pro.name || "",
    photoUrl: pro.photoUrl || pro.avatarUrl || "",
    coverUrl: pro.coverUrl || "",
    bio: pro.bio || "",
    gallery: Array.isArray(pro.gallery) ? pro.gallery : [],
    followersCount: (pro.metrics && Number(pro.metrics.followers)) || 0,
  };

  // set `pro` and `publicFromPro` for later merging below
  const publicFromPro = pro ? proToBarber(pro) : null;
  // keep the original `pro` variable name used later by the handler:
  // (we'll overwrite the later 'const pro = await Pro.findOne...' or adapt below)
  // NOTE: We'll still run the standard merging code below which expects `pro` variable,
  // so if the code later does `const pro = await Pro.findOne({ ownerUid }).lean()` you can skip that part.
}
const ownerUid = client.uid;

    // 2) pro doc if exists
    const pro = await Pro.findOne({ ownerUid }).lean().catch(() => null);
    const publicFromPro = pro ? proToBarber(pro) : null;

    // 3) Merge identity fields (client primary)
    const profilePublic = {
      ownerUid,
      username: client.username || (publicFromPro && publicFromPro.id) || "",
      displayName: client.displayName || client.fullName || (publicFromPro && publicFromPro.name) || "",
      avatarUrl: client.photoUrl || (publicFromPro && publicFromPro.photoUrl) || "",
      coverUrl: client.coverUrl || (pro?.coverUrl || ""),
      bio: client.bio || (pro?.bio || "") || "",
      isPro: Boolean(pro),
      services: (publicFromPro && publicFromPro.services) || [],
      gallery: (publicFromPro && publicFromPro.gallery) || (client.gallery || []),
      contactPublic: (pro && pro.contactPublic) || {},
      badges: (publicFromPro && publicFromPro.badges) || [],
      metrics: (pro && pro.metrics) || {},
      followersCount: 0,
      postsCount: 0,
      jobsCompleted: 0,
      ratingAverage: Number((pro && pro.metrics && pro.metrics.avgRating) || 0),
    };

    // counts & posts (same logic as username route)
    profilePublic.followersCount = Number(pro?.metrics?.followers || client.followersCount || 0);

    try {
      profilePublic.postsCount = await Post.countDocuments({
        proOwnerUid: ownerUid,
        isPublic: true,
        hidden: { $ne: true },
        deleted: { $ne: true },
      });
    } catch (e) {
      profilePublic.postsCount = Number(pro?.metrics?.postsCount || 0);
    }

    if (pro?.metrics?.jobsCompleted) {
      profilePublic.jobsCompleted = Number(pro.metrics.jobsCompleted || 0);
    } else {
      try {
        const bookingQueryOr = [{ proOwnerUid: ownerUid }, { proUid: ownerUid }];
        if (pro && pro._id) {
          try { bookingQueryOr.push({ proId: new mongoose.Types.ObjectId(pro._id) }); } catch {}
        }
        profilePublic.jobsCompleted = await Booking.countDocuments({
          $and: [{ status: "completed" }, { $or: bookingQueryOr }],
        });
      } catch (e) {
        profilePublic.jobsCompleted = 0;
      }
    }

    if (pro?.metrics?.avgRating) profilePublic.ratingAverage = Number(pro.metrics.avgRating);

    const postsRaw = await Post.find({
      proOwnerUid: ownerUid,
      isPublic: true,
      hidden: { $ne: true },
      deleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const pIds = postsRaw.map((p) => p._id?.toString()).filter(Boolean);
    let statsMap = {};
    if (pIds.length && PostStats) {
      const stats = await PostStats.find({ postId: { $in: pIds } }).lean().catch(() => []);
      statsMap = stats.reduce((acc, s) => {
        acc[String(s.postId)] = s;
        return acc;
      }, {});
    }

    const publicPosts = postsRaw.map((p) => {
      const s = statsMap[String(p._id)] || {};
      return {
        id: p._id?.toString?.() || String(p._id),
        proOwnerUid: p.proOwnerUid || "",
        proId: p.proId ? String(p.proId) : null,
        text: p.text,
        media: p.media || [],
        createdAt: p.createdAt,
        stats: {
          likes: Number(s.likesCount || s.likes || 0),
          comments: Number(s.commentsCount || s.comments || 0),
          shares: Number(s.sharesCount || s.shares || 0),
          views: Number(s.viewsCount || s.views || 0),
        },
      };
    });

    const payload = { ok: true, profile: profilePublic, posts: { items: publicPosts, cursor: null } };

    // cache
    if (redisClient) {
      try {
        await redisClient.setEx(cacheKey, PUBLIC_PROFILE_CACHE_SEC, JSON.stringify(payload));
      } catch (e) {
        console.warn("[public/profile-by-uid] redis set failed:", e?.message || e);
      }
    }

    return res.json(payload);
  } catch (e) {
    console.error("[public/profile-by-uid] err:", e?.stack || e);
    return res.status(500).json({ error: "server_error" });
  }
});



/* ------------------------------------------------------------------
   ADMIN READ (now shows livenessVerifiedAt too)
   ------------------------------------------------------------------ */
router.get(
  "/profile/client/:uid/admin",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const p = await ClientProfile.findOne({
        uid: req.params.uid,
      }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load client profile" });
    }
  }
);

/* ------------------------------------------------------------------
   PRO CAN VIEW CLIENT FOR A BOOKING
   ------------------------------------------------------------------ */
router.get(
  "/profile/client/:uid/for-booking/:bookingId",
  requireAuth,
  async (req, res) => {
    try {
      const b = await Booking.findById(req.params.bookingId).lean();
      if (!b) return res.status(404).json({ error: "Booking not found" });

      let isProOwner = false;

      if (b.proOwnerUid && b.proOwnerUid === req.user.uid) {
        isProOwner = true;
      } else if (b.proId) {
        const pro = await Pro.findOne({
          _id: b.proId,
          ownerUid: req.user.uid,
        })
          .select("_id")
          .lean();
        if (pro) isProOwner = true;
      }

      const canView = [
        "pending_payment",
        "scheduled",
        "accepted",
        "completed",
      ].includes(b.status);

      if (!(isProOwner && canView)) {
        return res.status(403).json({
          error: "Not authorized to view client details for this booking",
        });
      }

      if (b.clientUid !== req.params.uid) {
        return res.status(400).json({ error: "Client UID does not match booking" });
      }

      const p = await ClientProfile.findOne({
        uid: req.params.uid,
      }).lean();
      const masked = maskClientProfileForClientView(p) || null;
      return res.json(masked);
    } catch (e) {
      return res
        .status(500)
        .json({ error: "Failed to load client profile for booking" });
    }
  }
);

/* ------------------------------------------------------------------
   PRO PROFILE (extras)
   ------------------------------------------------------------------ */
router.get("/profile/pro/:proId", async (req, res) => {
  try {
    const p = await ProProfile.findOne({
      proId: req.params.proId,
    }).lean();
    if (!p) return res.json(null);
    return res.json(filterProPublic(p));
  } catch {
    return res.status(500).json({ error: "Failed to load pro profile" });
  }
});

router.put("/profile/pro/me", requireAuth, async (req, res) => {
  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (!pro) {
      return res.status(403).json({ error: "You are not an approved professional" });
    }

    const payload = req.body || {};
    const toSet = { ...payload, ownerUid: req.user.uid, proId: pro._id };
    const updated = await ProProfile.findOneAndUpdate(
      { ownerUid: req.user.uid },
      { $set: toSet },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const { ownerUid, ...safe } = updated || {};
    return res.json(safe || null);
  } catch {
    return res.status(500).json({ error: "Failed to save pro profile" });
  }
});

router.get(
  "/profile/pro/:proId/admin",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const p = await ProProfile.findOne({
        proId: req.params.proId,
      }).lean();
      return res.json(p || null);
    } catch {
      return res.status(500).json({ error: "Failed to load pro profile" });
    }
  }
);

export default router;
