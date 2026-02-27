// apps/api/services/faceGate.js
import mongoose from "mongoose";
import fetch from "node-fetch";
import { expandMediaForClient } from "./mediaResolver.js";
import {
  RekognitionClient,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
} from "@aws-sdk/client-rekognition";

const REGION = process.env.AWS_REGION || "us-east-1";
const rek = new RekognitionClient({ region: REGION });

const FACE_SIMILARITY_MIN = Number(process.env.FACE_MATCH_MIN_SIMILARITY || 85);
const FACE_GATE_TTL_MS = Number(process.env.FACE_GATE_TTL_MS || 10 * 60 * 1000); // 10 mins

function now() {
  return new Date();
}

function ms(v) {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

async function getProfile(uid) {
  const col = mongoose.connection.db.collection("profiles");
  return col.findOne({ uid }) || null;
}

async function setProfile(uid, patch) {
  const col = mongoose.connection.db.collection("profiles");
  await col.updateOne({ uid }, { $set: { uid, ...patch } }, { upsert: true });
}

async function fetchBytesFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch_failed_${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function resolveAssetToUrl({ assetId, legacyUrl }) {
  const [resolved] = await expandMediaForClient([
    { assetId: assetId || null, url: legacyUrl || "", type: "image" },
  ]);
  return resolved?.url || legacyUrl || "";
}

/**
 * Runs face compare using:
 * - Liveness ReferenceImage (from GetFaceLivenessSessionResults)
 * - Enrolled image from profile.face.enrolledAssetId (asset pipeline)
 */
async function runCompare({
  uid,
  sessionId,
  enrolledAssetId,
  enrolledLegacyUrl,
}) {
  const livenessOut = await rek.send(
    new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
  );

  const status = livenessOut?.Status || livenessOut?.status || "";
  if (status !== "SUCCEEDED") {
    return { ok: false, code: "liveness_not_succeeded", detail: status };
  }

  const ref = livenessOut?.ReferenceImage || null;
  const refBytesRaw = ref?.Bytes || null;

  if (!refBytesRaw) {
    return { ok: false, code: "missing_reference_image" };
  }

  // Normalize to Buffer for safety
  const refBytes = Buffer.isBuffer(refBytesRaw)
    ? refBytesRaw
    : Buffer.from(refBytesRaw);

  // Enrolled image bytes (your stored profile image)
  const enrolledUrl = await resolveAssetToUrl({
    assetId: enrolledAssetId,
    legacyUrl: enrolledLegacyUrl,
  });
  if (!enrolledUrl) return { ok: false, code: "missing_enrolled_image_url" };

  const enrolledBytes = await fetchBytesFromUrl(enrolledUrl);

  const cmp = await rek.send(
    new CompareFacesCommand({
      SourceImage: { Bytes: refBytes }, // liveness reference
      TargetImage: { Bytes: enrolledBytes }, // enrolled photo
      SimilarityThreshold: FACE_SIMILARITY_MIN,
    }),
  );

  const matches = Array.isArray(cmp?.FaceMatches) ? cmp.FaceMatches : [];
  const best = matches.length ? matches[0] : null;
  const similarity = Number(best?.Similarity || 0);

  const ok = similarity >= FACE_SIMILARITY_MIN;

  return {
    ok,
    code: ok ? "match" : "no_match",
    similarity,
    liveness: {
      sessionId,
      confidence: livenessOut?.Confidence ?? null,
      status,
    },
  };
}

/**
 * Central FaceGate:
 * - If lastVerifiedAt is fresh => allow.
 * - Else require last liveness sessionId + enrolled image, run compare, persist.
 */
export async function requireFaceGate(req, res, next, opts = {}) {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const {
      reason = "sensitive_action",
      force = false, // if true, always re-run compare
    } = opts;

    const p = await getProfile(uid);
    const face = p?.face || {};
    const liveness = p?.liveness || {};

    // 1) Quick allow if recently verified
    const lastOkAt = ms(face.lastVerifiedAt);
    const freshOk = lastOkAt && Date.now() - lastOkAt < FACE_GATE_TTL_MS;

    if (!force && freshOk) {
      return next();
    }

    // 2) Need enrolled image
    const enrolledAssetId =
      face.enrolledAssetId ||
      p?.photoAssetId ||
      p?.identity?.photoAssetId ||
      null;
    const enrolledLegacyUrl = p?.photoUrl || p?.identity?.photoUrl || "";

    if (!enrolledAssetId && !enrolledLegacyUrl) {
      return res.status(403).json({
        error: "face_enroll_required",
        message: "Enroll a clear selfie photo before using this feature.",
      });
    }

    // 3) Need recent liveness sessionId
    const sessionId = String(
      liveness.lastSessionId || p?.livenessRaw?.sessionId || "",
    ).trim();

    if (!sessionId) {
      return res.status(403).json({
        error: "liveness_required",
        message: "Please complete liveness verification first.",
      });
    }

    // 4) Compare
    const out = await runCompare({
      uid,
      sessionId,
      enrolledAssetId,
      enrolledLegacyUrl,
    });

    // 5) Persist audit
    await setProfile(uid, {
      face: {
        ...(face || {}),
        enrolledAssetId: enrolledAssetId || face.enrolledAssetId || null,
        lastCheckedAt: now(),
        lastVerifiedAt: out.ok ? now() : face.lastVerifiedAt || null,
        lastSimilarity: out.similarity ?? 0,
        lastSessionId: sessionId,
        lastReason: reason,
        lastStatus: out.code,
      },
      liveness: {
        ...(liveness || {}),
        lastSessionId: sessionId,
        lastVerifiedAt:
          p?.livenessVerifiedAt || liveness.lastVerifiedAt || null,
      },
    });

    if (!out.ok) {
      return res.status(403).json({
        error: "face_mismatch",
        message: "Face verification failed. Please retry in good lighting.",
        similarity: out.similarity ?? 0,
        minSimilarity: FACE_SIMILARITY_MIN,
      });
    }

    return next();
  } catch (e) {
    console.error("[faceGate] error:", e?.message || e);
    return res.status(500).json({ error: "face_gate_failed" });
  }
}
