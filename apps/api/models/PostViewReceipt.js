import mongoose from "mongoose";

const PostViewReceiptSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    viewerId: { type: String, required: true },
    countedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// One mutable receipt per viewer/post makes the ten-second view window
// durable across Redis outages and server restarts.
PostViewReceiptSchema.index(
  { postId: 1, viewerId: 1 },
  { unique: true, name: "post_view_receipt_unique" },
);

const PostViewReceipt =
  mongoose.models.PostViewReceipt ||
  mongoose.model("PostViewReceipt", PostViewReceiptSchema);

export default PostViewReceipt;
