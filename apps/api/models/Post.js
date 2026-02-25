// apps/api/models/Post.js
import mongoose from "mongoose";

const MediaSchema = new mongoose.Schema(
  {
    // explicit typing
    type: { type: String, enum: ["image", "video"], required: true },

    // ✅ NEW pipeline (canonical)
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: "MediaAsset" },
    thumbnailAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MediaAsset",
    },

    // ✅ LEGACY pipeline (temporary)
    url: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },

    // optional cached dims/duration for legacy or when available
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
  },
  { _id: false },
);

// ✅ Guard: require either assetId OR url (prevents empty media items)
MediaSchema.path("url").validate(function validateMediaUrlOrAssetId() {
  const hasAsset = !!this.assetId;
  const hasUrl = typeof this.url === "string" && this.url.trim().length > 0;
  return hasAsset || hasUrl;
}, "Media item must have either assetId or url");

// cached author snapshot for fast feed rendering
const ProSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Pro" },
    name: { type: String, default: "Professional" },
    lga: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
  },
  { _id: false },
);

const PostSchema = new mongoose.Schema(
  {
    // ownership
    proOwnerUid: { type: String, required: true, index: true }, // Firebase UID of the Pro owner
    proId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pro",
      required: true,
      index: true,
    },

    ownerUid: { type: String, default: "", index: true }, // canonical owner
    createdBy: { type: String, default: "", index: true }, // compat

    // snapshot of the author (denormalized for speed)
    pro: { type: ProSnapshotSchema, required: true },

    // content
    type: {
      type: String,
      enum: ["post", "story"],
      default: "post",
      index: true,
    }, // ✅ NEW
    expiresAt: { type: Date, default: null, index: true }, // ✅ NEW (do NOT TTL delete)

    text: { type: String, default: "" },
    media: { type: [MediaSchema], default: [] },
    tags: { type: [String], default: [], index: true },

    // visibility / scoping
    lga: { type: String, default: "", index: true }, // UPPERCASE (see save hook)
    isPublic: { type: Boolean, default: true, index: true },

    // moderation
    hidden: { type: Boolean, default: false, index: true },
    hiddenBy: { type: String, default: "" }, // admin / owner uid
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },

    // comments control
    commentsDisabled: { type: Boolean, default: false },

    // edits
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// helpful indexes for feeds
PostSchema.index({ isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
PostSchema.index({ lga: 1, isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
PostSchema.index({ proOwnerUid: 1, createdAt: -1 });

// normalize LGA casing
PostSchema.pre("save", function normalize(next) {
  if (this.lga) this.lga = String(this.lga).toUpperCase();

  // ✅ Story expiry: 24h from creation if not set
  if (this.type === "story" && !this.expiresAt) {
    const base = this.createdAt ? new Date(this.createdAt) : new Date();
    this.expiresAt = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  }

  next();
});

const Post = mongoose.models.Post || mongoose.model("Post", PostSchema);
export default Post;
