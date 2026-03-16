//apps/api/services/callRingJobs.js
import { Queue } from "bullmq";
import bullRedis from "../bullmqRedis.js";

export const CALL_RING_QUEUE = "call-ring";

const queue = new Queue(CALL_RING_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

export async function enqueueCallRingJob({
  callId,
  receiverUid,
  payload,
  delayMs,
  attemptNumber,
  maxRepeats,
  intervalMs,
}) {
  if (!callId) throw new Error("callId required");
  if (!receiverUid) throw new Error("receiverUid required");
  if (!payload) throw new Error("payload required");

  return queue.add(
    "repeat-ring",
    {
      callId,
      receiverUid,
      payload,
      attemptNumber,
      maxRepeats,
      intervalMs,
    },
    {
      delay: Math.max(0, Number(delayMs || 0)),
      jobId: `call-ring:${callId}:${receiverUid}:${attemptNumber}`,
    },
  );
}
