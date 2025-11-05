// apps/api/models/Post.js
import mongoose from "mongoose";

const MediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: "" },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 }, // for videos
  },
  { _id: false }
);

// cached author snapshot for fast feed rendering
const ProSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Pro" },
    name: { type: String, default: "Professional" },
    lga: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    // ownership
    proOwnerUid: { type: String, required: true, index: true }, // Firebase UID of the Pro owner
    proId: { type: mongoose.Schema.Types.ObjectId, ref: "Pro", required: true, index: true },

    // snapshot of the author (denormalized for speed)
    pro: { type: ProSnapshotSchema, required: true },

    // content
    text: { type: String, default: "" },
    media: { type: [MediaSchema], default: [] },
    tags: { type: [String], default: [], index: true },

    // visibility / scoping
    lga: { type: String, default: "", index: true }, // UPPERCASE (see save hook)
    isPublic: { type: Boolean, default: true, index: true },

    // moderation
    hidden: { type: Boolean, default: false, index: true },
    hiddenBy: { type: String, default: "" }, // admin uid
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },

    // edits
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// helpful indexes for feeds
PostSchema.index({ isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
PostSchema.index({ lga: 1, isPublic: 1, hidden: 1, deleted: 1, createdAt: -1 });
PostSchema.index({ proOwnerUid: 1, createdAt: -1 });

// normalize LGA casing
PostSchema.pre("save", function normalize(next) {
  if (this.lga) this.lga = String(this.lga).toUpperCase();
  next();
});

const Post = mongoose.models.Post || mongoose.model("Post", PostSchema);
export default Post;
