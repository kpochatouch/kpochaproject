// apps/worker/worker.js
import { Worker } from "bullmq";
import bullRedis from "./bullmqRedis.js";
import mongoose from "mongoose";
import MediaAsset from "../api/models/MediaAsset.js";
import { processVideo } from "./ffmpeg.js";
import CallRecord from "../api/models/CallRecord.js";
import { sendTransientPush } from "../api/services/notificationService.js";
import { CALL_RING_QUEUE } from "./callRingQueue.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

console.log("[worker] booting…");
console.log("[worker] node", process.version);

console.log("[worker] has MONGODB_URI?", !!process.env.MONGODB_URI);

process.on("SIGTERM", () => {
  console.warn("[worker] SIGTERM received");
  logMemory("SIGTERM");
});

process.on("SIGINT", () => {
  console.warn("[worker] SIGINT received");
  logMemory("SIGINT");
});

process.on("beforeExit", (code) => {
  console.warn("[worker] beforeExit code=", code);
  logMemory("beforeExit");
});

process.on("exit", (code) => {
  console.warn("[worker] exit code=", code);
});

await mongoose.connect(mustEnv("MONGODB_URI"));
console.log("[worker] ✅ mongo connected");

function callStillRinging(call) {
  if (!call) return false;
  if (call.endedAt) return false;
  if (call.connectedAt) return false;
  return ["initiated", "ringing"].includes(call.status);
}

function logMemory(tag) {
  const m = process.memoryUsage();
  const toMB = (n) => Math.round((n / 1024 / 1024) * 10) / 10;
  console.log(
    `[worker][mem] ${tag} rss=${toMB(m.rss)}MB heapUsed=${toMB(
      m.heapUsed,
    )}MB heapTotal=${toMB(m.heapTotal)}MB external=${toMB(m.external)}MB`,
  );
}

setInterval(() => {
  logMemory("heartbeat");
}, 15000);

const worker = new Worker(
  "media-processing",
  async (job) => {
    const { assetId } = job.data;
    console.log("[worker] job start", job.name, assetId);
    logMemory(`before job ${job.name}:${assetId}`);

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
      logMemory(`after job ${job.name}:${assetId}`);
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
      logMemory(`failed job ${job.name}:${assetId}`);

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
  {
    connection: bullRedis,
    concurrency: 1,
  },
);

worker.on("active", (job) => {
  console.log(`[worker] active id=${job.id} name=${job.name}`);
  logMemory(`active ${job.name}:${job.id}`);
});

worker.on("completed", (job) => {
  console.log(`[worker] completed id=${job.id} name=${job.name}`);
  logMemory(`completed ${job.name}:${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] failed id=${job?.id} name=${job?.name}`, err);
  logMemory(`failed ${job?.name}:${job?.id}`);
});

const callRingWorker = new Worker(
  CALL_RING_QUEUE,
  async (job) => {
    const {
      callId,
      receiverUid,
      payload,
      attemptNumber = 1,
      maxRepeats = 4,
      intervalMs = 8000,
    } = job.data || {};

    if (!callId || !receiverUid || !payload) {
      console.log("[worker] call-ring job missing required data");
      return;
    }

    const call = await CallRecord.findOne({ callId })
      .select("status connectedAt endedAt")
      .lean();

    if (!callStillRinging(call)) {
      console.log("[worker] call-ring skipped; call no longer ringing", callId);
      return;
    }

    console.log(
      "[worker] call-ring send",
      callId,
      receiverUid,
      "attempt",
      attemptNumber,
    );

    await sendTransientPush(receiverUid, {
      ...payload,
      data: {
        ...(payload?.data || {}),
        ringAttempt: String(attemptNumber),
        transient: "1",
      },
    });

    const nextAttempt = Number(attemptNumber) + 1;

    if (nextAttempt <= Number(maxRepeats)) {
      await job.queue.add(
        "repeat-ring",
        {
          callId,
          receiverUid,
          payload,
          attemptNumber: nextAttempt,
          maxRepeats,
          intervalMs,
        },
        {
          delay: Number(intervalMs),
          jobId: `call-ring:${callId}:${receiverUid}:${nextAttempt}`,
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      );
    }
  },
  { connection: bullRedis },
);

callRingWorker.on("ready", () =>
  console.log("[worker] ✅ call-ring queue ready"),
);

callRingWorker.on("error", (e) =>
  console.error("[worker] call-ring queue error", e?.message || e),
);

worker.on("ready", () => console.log("[worker] ✅ queue ready"));
worker.on("error", (e) =>
  console.error("[worker] queue error", e?.message || e),
);
