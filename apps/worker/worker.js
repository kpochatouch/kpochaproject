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
      const msg = String(e?.message || e || "unknown_error");
      const stderr =
        typeof e?.stderr === "string" ? e.stderr.slice(0, 4000) : "";
      const stdout =
        typeof e?.stdout === "string" ? e.stdout.slice(0, 2000) : "";

      console.error("[worker] ❌ job failed", assetId);
      console.error("[worker] message:", msg);
      if (stderr) console.error("[worker] stderr:", stderr);
      if (stdout) console.error("[worker] stdout:", stdout);

      asset.status = "failed";
      asset.error = {
        message: msg,
        step: "processing",
        ...(stderr ? { stderr } : {}),
        ...(stdout ? { stdout } : {}),
      };
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
