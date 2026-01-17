// apps/api/services/callService.js
import CallRecord from "../models/CallRecord.js";
import mongoose from "mongoose";
import { createNotification } from "./notificationService.js";

let _getIO = () => null;
export function setGetIO(fn) {
  _getIO = typeof fn === "function" ? fn : () => null;
}
function getIO() {
  try {
    return _getIO() || null;
  } catch {
    return null;
  }
}

function userRoom(uid) {
  return `user:${String(uid)}`;
}

function emitToUser(uid, event, payload) {
  try {
    const io = getIO();
    if (!io || !uid) return;
    io.to(userRoom(uid)).emit(event, payload);
  } catch (err) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn("[callService] emitToUser failed", err?.message || err);
  }
}

function emitToRoom(room, event, payload) {
  try {
    const io = getIO();
    if (!io || !room) return;
    io.to(room).emit(event, payload);
  } catch (err) {
    // non-fatal
    // eslint-disable-next-line no-console
    console.warn("[callService] emitToRoom failed", err?.message || err);
  }
}

/**
 * createCall
 *
 * Creates a CallRecord and notifies recipients.
 * - callId: string (required)
 * - room: signaling room (required)
 * - callerUid: required
 * - receiverUids: array of recipient uids (for 1:1 use [otherUid])
 * - callType: "audio" | "video"
 * - meta: optional
 *
 * Returns call doc.
 */
export async function createCall({
  callId,
  room,
  callerUid,
  receiverUids = [],
  callType = "audio",
  meta = {},
  participants = null, // optional pre-built participants array
} = {}) {
  if (!callId) throw new Error("callId required");
  if (!room) throw new Error("room required");
  if (!callerUid) throw new Error("callerUid required");

  // Normalize participants
  const parts = Array.isArray(participants)
    ? participants
    : [
        { uid: callerUid, role: "caller" },
        ...Array.from(
          new Set(Array.isArray(receiverUids) ? receiverUids : [])
        ).map((u) => ({
          uid: u,
          role: "receiver",
        })),
      ];

  // receiverUid convenience (first non-caller)
  const receiverUid = (Array.isArray(receiverUids) && receiverUids[0]) || null;

  // create record (unique callId)
  let call;
  try {
    call = await CallRecord.create({
      callId,
      room,
      participants: parts,
      callerUid,
      receiverUid,
      status: "initiated",
      callType,
      startedAt: new Date(),
      meta: meta || {},
    });
  } catch (err) {
    // If unique index collision, try to return existing record
    if (err && err.code === 11000) {
      call = await CallRecord.findOne({ callId }).lean();
      if (call) return call;
    }
    throw err;
  }

  // ✅ Normalize caller identity so receiver UI never shows "Unknown caller"
  // We accept different meta shapes from different callers (DM vs booking)
  const callerName =
    meta?.fromName ||
    meta?.callerName ||
    meta?.fromLabel ||
    meta?.displayName ||
    meta?.name ||
    null;

  const callerAvatar =
    meta?.fromAvatar ||
    meta?.callerAvatar ||
    meta?.avatarUrl ||
    meta?.photoUrl ||
    meta?.photoURL ||
    null;

  const payload = {
    id: String(call._id),
    callId: call.callId,
    room: call.room,
    callerUid,
    participants: call.participants,
    callType: call.callType,
    status: call.status,
    startedAt: call.startedAt,
    meta: call.meta,
    createdAt: call.createdAt,
  };

  // Emit incoming call to each receiver's personal room
  try {
    const receiverUidsUnique = parts
      .map((p) => p.uid)
      .filter((u) => u && u !== callerUid)
      .filter((v, i, a) => a.indexOf(v) === i);

    for (const uid of receiverUidsUnique) {
      // socket event
      emitToUser(uid, "call:incoming", {
        ...payload,
        toUid: uid,

        // ✅ top-level compatibility (some UIs read these directly)
        fromUid: callerUid,
        callerName: callerName || String(callerUid),
        callerAvatar: callerAvatar || "",

        // ✅ meta compatibility (your App.jsx reads meta.fromName/meta.callerName)
        meta: {
          ...(payload.meta || {}),
          fromUid: callerUid,
          fromName: callerName || String(callerUid),
          fromAvatar: callerAvatar || "",

          callerUid,
          callerName: callerName || String(callerUid),
          callerAvatar: callerAvatar || "",
        },
      });

      // create app notification (best-effort)
      try {
        await createNotification({
          toUid: uid,
          fromUid: callerUid,
          type: "call_incoming",
          data: { callId, room, callType, callerUid },
          meta: { source: "callService" },
        });
      } catch (e) {
        console.warn(
          "[callService] createNotification(call_incoming) failed:",
          e?.message || e
        );
      }
    }
  } catch (err) {
    console.warn("[callService] notify receivers failed:", err?.message || err);
  }

  // Also emit to the call room so anyone listening can see initiation
  emitToRoom(room, "call:created", payload);

  return call;
}

/**
 * updateCallStatus
 *
 * Safe update helper to change status and timestamps.
 * Accepts updates: { status, connectedAt, endedAt, meta }
 */
export async function updateCallStatus(callId, updates = {}) {
  if (!callId) throw new Error("callId required");
  const allowed = [
    "status",
    "connectedAt",
    "endedAt",
    "meta",
    "recordingUrl",
    "archived",
  ];
  const set = {};
  for (const k of Object.keys(updates || {})) {
    if (allowed.includes(k)) set[k] = updates[k];
  }

  // If endedAt provided, compute duration after update
  const doc = await CallRecord.findOneAndUpdate(
    { callId },
    { $set: set },
    { new: true }
  );
  if (!doc) throw new Error("call_not_found");

  if (doc.endedAt && doc.connectedAt) {
    doc.computeDuration();
    await doc.save();
  }

  // Broadcast status to room and participants
  const statusPayload = {
    id: String(doc._id),
    callId: doc.callId,
    status: doc.status,
    connectedAt: doc.connectedAt,
    endedAt: doc.endedAt,
    duration: doc.duration,
    meta: doc.meta,
  };

  // emit to room
  emitToRoom(doc.room, "call:status", statusPayload);

  // emit to each participant user room
  (doc.participants || []).forEach((p) => {
    emitToUser(p.uid, "call:status", statusPayload);
  });

  return doc;
}

/**
 * acceptCall
 *
 * Marks call as connected (accepted) by a participant.
 * Will set connectedAt (first acceptor) and status accepted.
 */
export async function acceptCall(callId, accepterUid) {
  if (!callId) throw new Error("callId required");
  if (!accepterUid) throw new Error("accepterUid required");

  const call = await CallRecord.findOne({ callId });
  if (!call) throw new Error("call_not_found");

  // Update status/connectedAt atomically if not yet accepted
  if (!call.connectedAt) {
    call.connectedAt = new Date();
  }
  call.status = "accepted";

  // ensure accepter is in participants list
  const uids = (call.participants || []).map((p) => p.uid);
  if (!uids.includes(accepterUid)) {
    call.participants.push({ uid: accepterUid, role: "participant" });
  }

  await call.save();

  const payload = {
    id: String(call._id),
    callId: call.callId,
    status: call.status,
    connectedAt: call.connectedAt,
    participants: call.participants,
  };

  // emit updates
  emitToRoom(call.room, "call:accepted", payload);
  (call.participants || []).forEach((p) =>
    emitToUser(p.uid, "call:accepted", payload)
  );

  return call;
}

/**
 * declineCall
 *
 * Marks call as declined by a participant. If all receivers declined, mark missed/ended.
 */
export async function declineCall(callId, declinerUid, reason = "declined") {
  if (!callId) throw new Error("callId required");
  if (!declinerUid) throw new Error("declinerUid required");

  const call = await CallRecord.findOne({ callId });
  if (!call) throw new Error("call_not_found");

  // If already ended, return
  if (["ended", "missed", "cancelled"].includes(call.status)) return call;

  // Mark status for this actor (we keep status at call-level; callers may track per-user signals in meta)
  call.meta = call.meta || {};
  call.meta.declines = Array.isArray(call.meta.declines)
    ? call.meta.declines
    : [];
  if (!call.meta.declines.includes(declinerUid))
    call.meta.declines.push(declinerUid);

  // If all receivers have declined, mark as "declined" -> endedAt
  const receiverUids = (call.participants || [])
    .filter((p) => p.uid !== call.callerUid)
    .map((p) => p.uid);
  const allDeclined =
    receiverUids.length > 0 &&
    receiverUids.every((u) => call.meta.declines.includes(u));

  if (allDeclined) {
    call.status = "declined";
    call.endedAt = new Date();
    call.computeDuration();
  }

  await call.save();

  const payload = {
    id: String(call._id),
    callId: call.callId,
    status: call.status,
    declinerUid,
    meta: call.meta,
    endedAt: call.endedAt,
  };

  emitToRoom(call.room, "call:declined", payload);
  (call.participants || []).forEach((p) =>
    emitToUser(p.uid, "call:declined", payload)
  );

  return call;
}

/**
 * cancelCall
 *
 * Caller cancels the call before it is accepted.
 */
export async function cancelCall(callId, cancelledByUid = null) {
  if (!callId) throw new Error("callId required");

  const call = await CallRecord.findOne({ callId });
  if (!call) throw new Error("call_not_found");

  if (["ended", "cancelled"].includes(call.status)) return call;

  call.status = "cancelled";
  call.endedAt = new Date();
  call.computeDuration();

  if (cancelledByUid)
    call.meta = {
      ...call.meta,
      cancelledBy: cancelledByUid,
      cancelledAt: new Date(),
    };

  await call.save();

  const payload = {
    id: String(call._id),
    callId: call.callId,
    status: call.status,
    endedAt: call.endedAt,
    meta: call.meta,
  };

  emitToRoom(call.room, "call:cancelled", payload);
  (call.participants || []).forEach((p) =>
    emitToUser(p.uid, "call:cancelled", payload)
  );

  return call;
}

/**
 * endCall
 *
 * Ends an active call (hangup) and computes duration.
 * endedStatus defaults to "ended" but may be "missed" / "busy" / "failed"
 */
export async function endCall(
  callId,
  endedStatus = "ended",
  endedByUid = null
) {
  if (!callId) throw new Error("callId required");

  const call = await CallRecord.findOne({ callId });
  if (!call) throw new Error("call_not_found");

  // Already ended?
  if (call.endedAt) return call;

  call.endedAt = new Date();
  call.status = endedStatus || "ended";
  if (endedByUid) call.meta = { ...call.meta, endedBy: endedByUid };
  call.computeDuration();
  await call.save();

  const payload = {
    id: String(call._id),
    callId: call.callId,
    status: call.status,
    duration: call.duration,
    connectedAt: call.connectedAt,
    endedAt: call.endedAt,
    meta: call.meta,
  };

  emitToRoom(call.room, "call:ended", payload);
  (call.participants || []).forEach((p) =>
    emitToUser(p.uid, "call:ended", payload)
  );

  // If endedStatus indicates missed and no one answered, create missed notifications
  if (
    endedStatus === "missed" ||
    (endedStatus === "ended" && (!call.connectedAt || call.duration === 0))
  ) {
    const receivers = (call.participants || [])
      .map((p) => p.uid)
      .filter((u) => u && u !== call.callerUid);
    for (const r of receivers) {
      try {
        await createNotification({
          toUid: r,
          fromUid: call.callerUid,
          type: "call_missed",
          data: {
            callId: call.callId,
            room: call.room,
            callType: call.callType,
            duration: call.duration,
          },
          meta: { source: "callService" },
        });
      } catch (e) {
        console.warn(
          "[callService] createNotification(call_missed) failed:",
          e?.message || e
        );
      }
    }
  }

  return call;
}

/**
 * getCallById
 * - supports either Mongo _id OR callId string
 */
export async function getCallById(idOrCallId) {
  if (!idOrCallId) throw new Error("callId required");

  const v = String(idOrCallId).trim();

  // if it looks like a Mongo ObjectId, fetch by _id
  if (mongoose.Types.ObjectId.isValid(v)) {
    const byId = await CallRecord.findById(v).lean();
    if (byId) return byId;
  }

  // otherwise (or fallback), fetch by callId
  return CallRecord.findOne({ callId: v }).lean();
}

/**
 * listRecentCallsForUser(uid, { limit = 50 })
 */
export async function listRecentCallsForUser(uid, { limit = 50 } = {}) {
  if (!uid) throw new Error("uid required");
  const take = Math.max(1, Math.min(200, Number(limit || 50)));
  // Use index participants.uid + createdAt
  const rows = await CallRecord.find({
    "participants.uid": uid,
    archived: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .limit(take)
    .lean();
  return rows;
}

/**
 * getActiveCallForUser(uid)
 * - returns a call that is not ended for which the user is a participant
 */
export async function getActiveCallForUser(uid) {
  if (!uid) throw new Error("uid required");
  return CallRecord.findOne({
    "participants.uid": uid,
    endedAt: null,
    status: { $nin: ["ended", "missed", "cancelled", "declined", "failed"] },
  }).sort({ createdAt: -1 });
}

export default {
  setGetIO,
  createCall,
  updateCallStatus,
  acceptCall,
  declineCall,
  cancelCall,
  endCall,
  getCallById,
  listRecentCallsForUser,
  getActiveCallForUser,
};
