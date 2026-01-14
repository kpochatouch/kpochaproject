// apps/api/scripts/emit_and_fetch_profile.js
import { getIO } from "../sockets/index.js";

const UID = "ldzCvKGbGheOtHQ3qvKs1nMRdDg2";
const POST_ID = "691df70f5474f9a8137ecfad";
const API_URL = `http://localhost:8080/api/profile/public-by-uid/${encodeURIComponent(UID)}`;

async function main() {
  try {
    // 1) emit post:created (forces realtime clients to update)
    try {
      const io = getIO();
      if (!io) {
        console.warn(
          "[emit] getIO() returned falsy — sockets may not be attached",
        );
      } else {
        io.emit("post:created", {
          _id: POST_ID,
          ownerUid: UID,
          text: "force emit — server-side test",
          isPublic: true,
          createdAt: new Date().toISOString(),
        });
        console.log(
          "[emit] emitted post:created ->",
          POST_ID,
          "ownerUid:",
          UID,
        );
      }
    } catch (e) {
      console.error("[emit] failed to emit:", e?.message || e);
    }

    // 2) fetch the profile endpoint from the running local server
    try {
      const res = await fetch(API_URL);
      const json = await res.json();
      console.log("[fetch] profile payload returned by server:");
      console.dir(json, { depth: 4 });
    } catch (e) {
      console.error("[fetch] failed:", e?.message || e);
    }

    process.exit(0);
  } catch (err) {
    console.error("Fatal:", err);
    process.exit(1);
  }
}

main();
