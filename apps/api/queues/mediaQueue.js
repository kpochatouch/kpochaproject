//apps/api/queues/mediaQueue.js
import { Queue } from "bullmq";
import bullRedis from "../bullmqRedis.js";

export const mediaQueue = new Queue("media-processing", {
  connection: bullRedis,
});
