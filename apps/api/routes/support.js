//apps/api/routes/support.js
import express from "express";
import SupportSession from "../models/SupportSession.js";
import SupportMessage from "../models/SupportMessage.js";
import { getSupportDecision } from "../services/supportAiService.js";
import { getIO } from "../sockets/index.js";

function mapSession(session) {
  return {
    id: String(session._id),
    userUid: session.userUid,
    mode: session.mode,
    status: session.status,
    escalated: !!session.escalated,
    escalatedAt: session.escalatedAt ? session.escalatedAt.getTime() : null,
    lastMessageAt: session.lastMessageAt
      ? session.lastMessageAt.getTime()
      : null,
    lastMessageText: session.lastMessageText || "",
    lastSender: session.lastSender || "",
    unreadAdminCount: Number(session.unreadAdminCount || 0),
    unreadUserCount: Number(session.unreadUserCount || 0),
    createdAt: session.createdAt ? session.createdAt.getTime() : null,
    updatedAt: session.updatedAt ? session.updatedAt.getTime() : null,
  };
}

function mapMessage(message) {
  return {
    id: String(message._id),
    sessionId: String(message.sessionId),
    sender: message.sender,
    text: message.text,
    readAt: message.readAt ? message.readAt.getTime() : null,
    deliveryStatus: message.deliveryStatus || "sent",
    createdAt: message.createdAt ? message.createdAt.getTime() : null,
    updatedAt: message.updatedAt ? message.updatedAt.getTime() : null,
  };
}

function emitToSupportUser(userUid, event, payload) {
  try {
    const io = getIO();
    if (!io || !userUid) return;
    io.to(`user:${String(userUid)}`).emit(event, payload);
  } catch (err) {
    console.warn("[support] emitToSupportUser failed:", err?.message || err);
  }
}

function emitToSupportSession(sessionId, event, payload) {
  try {
    const io = getIO();
    if (!io || !sessionId) return;
    io.to(`support:session:${String(sessionId)}`).emit(event, payload);
  } catch (err) {
    console.warn("[support] emitToSupportSession failed:", err?.message || err);
  }
}

function emitToSupportAdmins(event, payload) {
  try {
    const io = getIO();
    if (!io) return;
    io.to("admins").emit(event, payload);
  } catch (err) {
    console.warn("[support] emitToSupportAdmins failed:", err?.message || err);
  }
}

async function getOrCreateOpenSupportSession(userUid) {
  let session = await SupportSession.findOne({
    userUid,
    status: "open",
  });

  if (!session) {
    session = await SupportSession.create({
      userUid,
      mode: "bot",
      status: "open",
      escalated: false,
      escalatedAt: null,
      lastMessageAt: null,
      lastMessageText: "",
      lastSender: "",
      unreadAdminCount: 0,
      unreadUserCount: 0,
    });
  }

  return session;
}

export default function supportRoutes({ requireAuth }) {
  const router = express.Router();

  router.post("/support/session", requireAuth, async (req, res) => {
    try {
      const session = await getOrCreateOpenSupportSession(req.user.uid);
      return res.json({
        ok: true,
        session: mapSession(session),
      });
    } catch (err) {
      console.error("[support/session] failed:", err?.message || err);
      return res.status(500).json({ error: "support_session_failed" });
    }
  });

  router.get("/support/messages", requireAuth, async (req, res) => {
    try {
      const session = await SupportSession.findOne({
        userUid: req.user.uid,
        status: "open",
      });

      if (!session) {
        return res.json({
          ok: true,
          session: null,
          messages: [],
        });
      }

      const messages = await SupportMessage.find({ sessionId: session._id })
        .sort({ createdAt: 1 })
        .limit(500);

      await SupportSession.updateOne(
        { _id: session._id },
        { $set: { unreadUserCount: 0 } },
      );

      await SupportMessage.updateMany(
        {
          sessionId: session._id,
          sender: "agent",
          readAt: null,
        },
        {
          $set: {
            readAt: new Date(),
            deliveryStatus: "read",
          },
        },
      );

      const refreshed = await SupportSession.findById(session._id);

      return res.json({
        ok: true,
        session: mapSession(refreshed),
        messages: messages.map(mapMessage),
      });
    } catch (err) {
      console.error("[support/messages:get] failed:", err?.message || err);
      return res.status(500).json({ error: "support_messages_failed" });
    }
  });

  router.post("/support/messages", requireAuth, async (req, res) => {
    try {
      const clean = String(req.body?.text || "").trim();
      if (!clean) {
        return res.status(400).json({ ok: false, error: "empty_message" });
      }

      const session = await getOrCreateOpenSupportSession(req.user.uid);

      const userMsg = await SupportMessage.create({
        sessionId: session._id,
        sender: "user",
        text: clean,
        readAt: null,
        deliveryStatus: "sent",
      });

      session.lastMessageAt = userMsg.createdAt;
      session.lastMessageText = userMsg.text;
      session.lastSender = "user";

      if (session.mode === "human") {
        session.unreadAdminCount = Number(session.unreadAdminCount || 0) + 1;
        await session.save();

        const payload = {
          session: mapSession(session),
          message: mapMessage(userMsg),
        };

        emitToSupportAdmins("admin-support:message", payload);
        emitToSupportAdmins("admin-support:session-updated", {
          session: mapSession(session),
        });
        emitToSupportUser(String(session.userUid), "support:message", payload);
        emitToSupportSession(String(session._id), "support:message", payload);

        return res.json({
          ok: true,
          session: mapSession(session),
          messages: [mapMessage(userMsg)],
        });
      }

      const historyDocs = await SupportMessage.find({ sessionId: session._id })
        .sort({ createdAt: 1 })
        .limit(20);

      let triage;
      try {
        triage = await getSupportDecision({
          text: clean,
          history: historyDocs.map((m) => ({
            sender: m.sender,
            text: m.text,
          })),
        });
      } catch (err) {
        console.error("[support-ai] failed:", err?.message || err);
        triage = {
          type: "escalate",
          text: "I’m escalating this conversation to a support specialist.",
        };
      }

      if (triage.type === "bot_reply") {
        const botMsg = await SupportMessage.create({
          sessionId: session._id,
          sender: "assistant",
          text: triage.text,
          readAt: new Date(),
          deliveryStatus: "read",
        });

        session.mode = "bot";
        session.escalated = false;
        session.escalatedAt = null;
        session.lastMessageAt = botMsg.createdAt;
        session.lastMessageText = botMsg.text;
        session.lastSender = "assistant";
        await session.save();

        const payloads = [
          {
            session: mapSession(session),
            message: mapMessage(userMsg),
          },
          {
            session: mapSession(session),
            message: mapMessage(botMsg),
          },
        ];

        payloads.forEach((payload) => {
          emitToSupportUser(
            String(session.userUid),
            "support:message",
            payload,
          );
          emitToSupportSession(String(session._id), "support:message", payload);
        });

        emitToSupportUser(String(session.userUid), "support:session-updated", {
          session: mapSession(session),
        });
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mapSession(session),
        });

        return res.json({
          ok: true,
          session: mapSession(session),
          messages: [mapMessage(userMsg), mapMessage(botMsg)],
        });
      }

      const handoffMsg = await SupportMessage.create({
        sessionId: session._id,
        sender: "assistant",
        text: triage.text,
        readAt: new Date(),
        deliveryStatus: "read",
      });

      session.mode = "human";
      session.escalated = true;
      session.escalatedAt = new Date();
      session.lastMessageAt = handoffMsg.createdAt;
      session.lastMessageText = handoffMsg.text;
      session.lastSender = "assistant";
      session.unreadAdminCount = Number(session.unreadAdminCount || 0) + 1;
      await session.save();

      const userPayload = {
        session: mapSession(session),
        message: mapMessage(userMsg),
      };

      const handoffPayload = {
        session: mapSession(session),
        message: mapMessage(handoffMsg),
      };

      emitToSupportUser(
        String(session.userUid),
        "support:message",
        userPayload,
      );
      emitToSupportUser(
        String(session.userUid),
        "support:message",
        handoffPayload,
      );
      emitToSupportUser(String(session.userUid), "support:session-updated", {
        session: mapSession(session),
      });

      emitToSupportSession(String(session._id), "support:message", userPayload);
      emitToSupportSession(
        String(session._id),
        "support:message",
        handoffPayload,
      );
      emitToSupportSession(String(session._id), "support:session-updated", {
        session: mapSession(session),
      });

      emitToSupportAdmins("admin-support:escalated", {
        session: mapSession(session),
        messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
      });
      emitToSupportAdmins("admin-support:session-updated", {
        session: mapSession(session),
      });

      return res.json({
        ok: true,
        session: mapSession(session),
        messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
      });
    } catch (err) {
      console.error("[support/messages:post] failed:", err?.message || err);
      return res.status(500).json({ error: "support_send_failed" });
    }
  });

  return router;
}
