//apps/api/routes/adminSupport.js
import express from "express";
import SupportSession from "../models/SupportSession.js";
import SupportMessage from "../models/SupportMessage.js";
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
    console.warn(
      "[admin-support] emitToSupportUser failed:",
      err?.message || err,
    );
  }
}

function emitToSupportSession(sessionId, event, payload) {
  try {
    const io = getIO();
    if (!io || !sessionId) return;
    io.to(`support:session:${String(sessionId)}`).emit(event, payload);
  } catch (err) {
    console.warn(
      "[admin-support] emitToSupportSession failed:",
      err?.message || err,
    );
  }
}

function emitToSupportAdmins(event, payload) {
  try {
    const io = getIO();
    if (!io) return;
    io.to("admins").emit(event, payload);
  } catch (err) {
    console.warn(
      "[admin-support] emitToSupportAdmins failed:",
      err?.message || err,
    );
  }
}

export default function adminSupportRoutes({ requireAuth, requireAdmin }) {
  const router = express.Router();

  router.get(
    "/admin/support/sessions",
    requireAuth,
    requireAdmin,
    async (_req, res) => {
      try {
        const sessions = await SupportSession.find({
          mode: "human",
          escalated: true,
          status: { $in: ["open", "closed"] },
        })
          .sort({ lastMessageAt: -1, updatedAt: -1 })
          .limit(200);

        return res.json({
          ok: true,
          sessions: sessions.map(mapSession),
        });
      } catch (err) {
        console.error("[admin/support/sessions] failed:", err?.message || err);
        return res.status(500).json({ error: "admin_support_sessions_failed" });
      }
    },
  );

  router.get(
    "/admin/support/sessions/:sessionId/messages",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const session = await SupportSession.findById(req.params.sessionId);
        if (!session) {
          return res
            .status(404)
            .json({ ok: false, error: "session_not_found" });
        }

        const messages = await SupportMessage.find({ sessionId: session._id })
          .sort({ createdAt: 1 })
          .limit(500);

        await SupportSession.updateOne(
          { _id: session._id },
          {
            $set: {
              unreadAdminCount: 0,
            },
          },
        );

        await SupportMessage.updateMany(
          {
            sessionId: session._id,
            sender: { $in: ["user", "assistant"] },
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
        console.error(
          "[admin/support/messages:get] failed:",
          err?.message || err,
        );
        return res.status(500).json({ error: "admin_support_messages_failed" });
      }
    },
  );

  router.post(
    "/admin/support/sessions/:sessionId/messages",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const clean = String(req.body?.text || "").trim();
        if (!clean) {
          return res.status(400).json({ ok: false, error: "empty_message" });
        }

        const session = await SupportSession.findById(req.params.sessionId);
        if (!session) {
          return res
            .status(404)
            .json({ ok: false, error: "session_not_found" });
        }

        const msg = await SupportMessage.create({
          sessionId: session._id,
          sender: "agent",
          text: clean,
          readAt: null,
          deliveryStatus: "sent",
        });

        session.mode = "human";
        session.escalated = true;
        session.lastMessageAt = msg.createdAt;
        session.lastMessageText = msg.text;
        session.lastSender = "agent";
        session.unreadUserCount = Number(session.unreadUserCount || 0) + 1;
        session.unreadAdminCount = 0;
        await session.save();

        const payload = {
          session: mapSession(session),
          message: mapMessage(msg),
        };

        emitToSupportUser(String(session.userUid), "support:message", payload);
        emitToSupportUser(String(session.userUid), "support:session-updated", {
          session: mapSession(session),
        });

        emitToSupportSession(String(session._id), "support:message", payload);
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mapSession(session),
        });

        emitToSupportAdmins("admin-support:message", payload);
        emitToSupportAdmins("admin-support:session-updated", {
          session: mapSession(session),
        });

        return res.json({
          ok: true,
          session: mapSession(session),
          message: mapMessage(msg),
        });
      } catch (err) {
        console.error(
          "[admin/support/messages:post] failed:",
          err?.message || err,
        );
        return res.status(500).json({ error: "admin_support_reply_failed" });
      }
    },
  );

  router.patch(
    "/admin/support/sessions/:sessionId",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const session = await SupportSession.findById(req.params.sessionId);
        if (!session) {
          return res
            .status(404)
            .json({ ok: false, error: "session_not_found" });
        }

        const nextStatus = req.body?.status;
        const nextMode = req.body?.mode;

        if (nextStatus && ["open", "closed"].includes(nextStatus)) {
          session.status = nextStatus;
        }

        if (nextMode && ["bot", "human"].includes(nextMode)) {
          session.mode = nextMode;
        }

        if (typeof req.body?.escalated === "boolean") {
          session.escalated = req.body.escalated;
          session.escalatedAt = req.body.escalated
            ? session.escalatedAt || new Date()
            : null;
        }

        await session.save();

        emitToSupportAdmins("admin-support:session-updated", {
          session: mapSession(session),
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
        });
      } catch (err) {
        console.error(
          "[admin/support/session:patch] failed:",
          err?.message || err,
        );
        return res
          .status(500)
          .json({ error: "admin_support_session_update_failed" });
      }
    },
  );

  router.get(
    "/admin/contact-messages",
    requireAuth,
    requireAdmin,
    async (_req, res) => {
      try {
        const { default: ContactMessage } = await import(
          "../models/ContactMessage.js"
        );

        const messages = await ContactMessage.find({})
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();

        return res.json({
          ok: true,
          messages,
        });
      } catch (err) {
        console.error("[admin/contact-messages] failed:", err?.message || err);
        return res.status(500).json({ error: "admin_contact_messages_failed" });
      }
    },
  );

  return router;
}
