// apps/worker/worker.js
import { Worker } from "bullmq";
import bullRedis from "./bullmqRedis.js";
import mongoose from "mongoose";
import MediaAsset from "../api/models/MediaAsset.js";
import { processVideo } from "./ffmpeg.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

console.log("[worker] booting…");
console.log("[worker] node", process.version);
console.log("[worker] bullRedis", {
  host: bullRedis?.host,
  port: bullRedis?.port,
  username: bullRedis?.username ? "set" : "unset",
  password: bullRedis?.password ? "set" : "unset",
  tls: bullRedis?.tls ? "on" : "off",
});

console.log("[worker] has MONGODB_URI?", !!process.env.MONGODB_URI);

await mongoose.connect(mustEnv("MONGODB_URI"));
console.log("[worker] ✅ mongo connected");

const worker = new Worker(
  "media-processing",
  async (job) => {
    const { assetId } = job.data;
    console.log("[worker] job start", job.name, assetId);

    const asset = await MediaAsset.findById(assetId);
    if (!asset) {
      console.log("[worker] job asset missing", assetId);
      return;
    }

    asset.status = "processing";
    await asset.save();

    try {
      await processVideo(asset);
      asset.status = "ready";
      await asset.save();
      console.log("[worker] ✅ job done", assetId);
    } catch (e) {
      console.error("[worker] ❌ job failed", assetId, e?.message || e);
      asset.status = "failed";
      asset.error = { message: e.message, step: "processing" };
      await asset.save();
      throw e;
    }
  },
  { connection: bullRedis },
);

worker.on("ready", () => console.log("[worker] ✅ queue ready"));
worker.on("error", (e) =>
  console.error("[worker] queue error", e?.message || e),
);
