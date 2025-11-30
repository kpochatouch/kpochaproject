// apps/api/models/CallRecord.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * CallRecord model
 *
 * Tracks the lifecycle of an audio/video call.
 * - callId: canonical id for the call event (UUID or generated string)
 * - room: signaling room / call room id (use same room used by WebRTC signaling)
 * - participants: array of participant objects { uid, role } (caller/receiver/guest)
 * - status: initiated | ringing | accepted | declined | ended | missed | busy | cancelled
 * - callType: audio | video
 * - timestamps: startedAt (offer sent), connectedAt (peer connection established), endedAt
 * - duration: seconds (computed when endedAt is set)
 * - recordingUrl: optional recording storage (if you support server-side recording)
 * - meta: freeform (ICE stats, provider ids, turn server used, SIP session id, etc.)
 */
const ParticipantSchema = new Schema(
  {
    uid: { type: String, required: true, index: true },
    role: { type: String, enum: ["caller", "receiver", "participant"], default: "participant" },
  },
  { _id: false }
);

const CallRecordSchema = new Schema(
  {
    callId: { type: String, required: true, index: true, unique: true },

    // Signaling room (used by socket.io namespace/room)
    room: { type: String, required: true, index: true },

    // Flexible participants array for 1:1 and group calls
    participants: { type: [ParticipantSchema], required: true },

    // Primary caller/initiator (convenience field)
    callerUid: { type: String, required: true, index: true },

    // Optional convenience receiver (for direct calls)
    receiverUid: { type: String, default: null, index: true },

    status: {
      type: String,
      enum: [
        "initiated",
        "ringing",
        "accepted",
        "declined",
        "ended",
        "missed",
        "busy",
        "cancelled",
        "failed"
      ],
      default: "initiated",
      index: true,
    },

    callType: {
      type: String,
      enum: ["audio", "video"],
      default: "audio",
      index: true,
    },

    // Times describing the lifecycle
    startedAt: { type: Date, default: null }, // when offer/initiated
    connectedAt: { type: Date, default: null }, // when media path established
    endedAt: { type: Date, default: null }, // when call ended / hangup

    // Computed duration in seconds (connectedAt -> endedAt)
    duration: { type: Number, default: 0 },

    // Optional recording URL if you support recording
    recordingUrl: { type: String, default: null },

    // Soft-delete / archived flag (for retention policies)
    archived: { type: Boolean, default: false, index: true },

    // Provider / debug metadata: TURN used, SIP ids, provider call id, ICE stats, networkQuality, etc.
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

/**
 * Indexes for common queries:
 * - recent calls by participant
 * - active / not-ended calls
 * - quick lookup by callId
 */
CallRecordSchema.index({ "participants.uid": 1, createdAt: -1 }, { name: "participant_recent_idx" });
CallRecordSchema.index({ callerUid: 1, receiverUid: 1, createdAt: -1 }, { name: "caller_receiver_idx" });
CallRecordSchema.index({ callId: 1 }, { name: "callId_idx" });
CallRecordSchema.index({ room: 1, createdAt: -1 }, { name: "room_recent_idx" });
CallRecordSchema.index({ status: 1, createdAt: -1 }, { name: "status_recent_idx" });

/**
 * Helpers
 */

// Compute duration when endedAt is set
CallRecordSchema.methods.computeDuration = function () {
  if (!this.connectedAt || !this.endedAt) return 0;
  const dur = Math.max(0, Math.floor((this.endedAt.getTime() - this.connectedAt.getTime()) / 1000));
  this.duration = dur;
  return dur;
};

// Mark call as connected (accepted)
CallRecordSchema.methods.markConnected = async function (connectedAt = new Date()) {
  this.connectedAt = connectedAt;
  this.status = "accepted";
  // startedAt can be set earlier by initiator; ensure it's set
  if (!this.startedAt) this.startedAt = connectedAt;
  // save and return duration (0 until ended)
  await this.save();
  return this;
};

// End the call and compute duration
CallRecordSchema.methods.endCall = async function (endedAt = new Date(), endedStatus = "ended") {
  this.endedAt = endedAt;
  this.status = endedStatus || "ended";
  this.computeDuration();
  await this.save();
  return this;
};

// Mark as missed (no one answered)
CallRecordSchema.methods.markMissed = async function () {
  this.status = "missed";
  this.endedAt = new Date();
  this.computeDuration();
  await this.save();
  return this;
};

// Convenience to find the other participants (uids) excluding a given uid
CallRecordSchema.methods.otherParticipants = function (uid) {
  return (this.participants || [])
    .map((p) => p.uid)
    .filter((u) => u && u !== uid);
};

/**
 * Pre-save validation / normalization
 */
CallRecordSchema.pre("validate", function (next) {
  // Ensure callId is present
  if (!this.callId) {
    return next(new Error("callId required"));
  }

  // Ensure callerUid is present and exists in participants
  if (!this.callerUid) {
    return next(new Error("callerUid required"));
  }

  const pUids = (this.participants || []).map((p) => p.uid);
  if (!pUids.includes(this.callerUid)) {
    // Add caller to participants automatically if missing
    this.participants = [{ uid: this.callerUid, role: "caller" }, ...(this.participants || [])];
  }

  // If receiverUid is set and not in participants add it
  if (this.receiverUid && !pUids.includes(this.receiverUid)) {
    this.participants.push({ uid: this.receiverUid, role: "receiver" });
  }

  next();
});

/**
 * Post-save hook: could trigger analytics / background jobs via service layer if needed.
 * (Keep lightweight here.)
 */

const CallRecord =
  mongoose.models.CallRecord || mongoose.model("CallRecord", CallRecordSchema);

export default CallRecord;
