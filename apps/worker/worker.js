//apps/worker/worker.js
import { Worker } from "bullmq";
import bullRedis from "./bullmqRedis.js";
import mongoose from "mongoose";
import MediaAsset from "../api/models/MediaAsset.js";
import { processVideo } from "./ffmpeg.js";

await mongoose.connect(process.env.MONGODB_URI);

const worker = new Worker(
  "media-processing",
  async (job) => {
    const { assetId } = job.data;

    const asset = await MediaAsset.findById(assetId);
    if (!asset) return;

    asset.status = "processing";
    await asset.save();

    try {
      await processVideo(asset);
      asset.status = "ready";
      await asset.save();
    } catch (e) {
      asset.status = "failed";
      asset.error = {
        message: e.message,
        step: "processing",
      };
      await asset.save();
      throw e;
    }
  },
  { connection: bullRedis },
);

console.log("Worker running...");
