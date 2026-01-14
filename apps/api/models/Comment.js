// apps/api/models/Comment.js
import mongoose from "mongoose";

const CommentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "Post",
    },
    ownerUid: { type: String, required: true }, // Firebase uid
    text: { type: String, default: "" },
    attachments: {
      type: [
        {
          url: String,
          type: { type: String, default: "image" }, // image | video | file
        },
      ],
      default: [],
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

CommentSchema.index({ postId: 1, createdAt: -1 });

const Comment =
  mongoose.models.Comment || mongoose.model("Comment", CommentSchema);

export default Comment;
