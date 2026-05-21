//apps/api/routes/support.js
import express from "express";
import admin from "firebase-admin";
import SupportSession from "../models/SupportSession.js";
import SupportMessage from "../models/SupportMessage.js";
import { getSupportDecision } from "../services/supportAiService.js";
import { getIO } from "../sockets/index.js";
import { Pro } from "../models.js";
import {
  sendTransientPush,
  createNotification,
} from "../services/notificationService.js";

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

async function decorateSessionIdentity(session) {
  const base = mapSession(session);

  let userName = "";
  let userEmail = "";

  try {
    const rec = await admin.auth().getUser(String(session.userUid));
    userName = rec?.displayName || "";
    userEmail = rec?.email || "";
  } catch {}

  return {
    ...base,
    userName,
    userEmail,
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

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase();
}

function isAffirmative(text) {
  const normalized = normalizeText(text);
  return /\b(yes|yeah|yep|sure|ok|okay|please|affirmative|absolutely|definitely|indeed|connect me|connect|human|agent|support specialist|live agent|customer service)\b/.test(
    normalized,
  );
}

function isNegative(text) {
  const normalized = normalizeText(text);
  return /\b(no|nah|nope|not now|do not|dont|never|later)\b/.test(normalized);
}

function isExplicitHumanRequest(text) {
  const normalized = normalizeText(text);
  return /\b(human|agent|admin|support specialist|customer service|live agent|real person|someone who can help|someone from support)\b/.test(
    normalized,
  );
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

async function buildSupportAiContext(req, session) {
  let displayName = "";
  let email = req.user?.email || "";
  let isPro = false;

  try {
    const rec = await admin.auth().getUser(String(req.user.uid));
    displayName = rec?.displayName || "";
    email = rec?.email || email || "";
  } catch {}

  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid })
      .select("_id")
      .lean();
    isPro = !!pro;
  } catch {}

  return {
    user: {
      uid: req.user.uid,
      email,
      displayName,
      isPro,
    },
    session: {
      mode: session?.mode || "bot",
      status: session?.status || "open",
      escalated: !!session?.escalated,
    },
    platform: [
      "Kpocha Touch is a social platform for professionals and clients",
      "Professionals showcase work through posts, photos, and videos",
      "Clients discover professionals in the feed and can book them",
      "Support chat can escalate to human support",
      "Sponsored adverts can appear in the feed",
    ],
  };
}

async function createAdminEscalationNotifications(
  session,
  userMsg,
  handoffMsg,
) {
  const adminUids = String(process.env.ADMIN_UIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminUids.length) return;

  const body =
    handoffMsg?.text ||
    userMsg?.text ||
    "A support conversation was escalated.";

  await Promise.allSettled(
    adminUids.map(async (uid) => {
      try {
        await createNotification({
          ownerUid: uid,
          actorUid: String(session.userUid),
          type: "support_escalated",
          data: {
            title: "Support escalation",
            body,
            sessionId: String(session._id),
            userUid: String(session.userUid),
            url: "/admin/support",
          },
          priority: "high",
          groupKey: `support:session:${String(session._id)}`,
        });
      } catch (err) {
        console.warn(
          "[support] createAdminEscalationNotifications failed:",
          err?.message || err,
        );
      }
    }),
  );
}

async function notifyAdminsOfEscalation(session, userMsg, handoffMsg) {
  const adminUids = String(process.env.ADMIN_UIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminUids.length) return;

  const preview =
    handoffMsg?.text ||
    userMsg?.text ||
    "A support conversation was escalated.";

  await Promise.allSettled(
    adminUids.map((uid) =>
      sendTransientPush(uid, {
        title: "Support escalation",
        body: preview,
        data: {
          type: "support_escalated",
          sessionId: String(session._id),
          userUid: String(session.userUid),
          url: "/admin/support",
        },
      }),
    ),
  );
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

  router.post("/support/session/restart", requireAuth, async (req, res) => {
    try {
      await SupportSession.updateMany(
        { userUid: req.user.uid, status: "open" },
        { $set: { status: "closed" } },
      );

      const session = await SupportSession.create({
        userUid: req.user.uid,
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

      return res.json({
        ok: true,
        session: mapSession(session),
      });
    } catch (err) {
      console.error("[support/session:restart] failed:", err?.message || err);
      return res.status(500).json({ error: "support_session_restart_failed" });
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

      const pendingEscalationPrompt = await SupportMessage.findOne({
        sessionId: session._id,
        sender: "assistant",
        "meta.confirmEscalation": true,
      })
        .sort({ createdAt: -1 })
        .lean();

      const userWantsEscalationNow = Boolean(
        pendingEscalationPrompt && isAffirmative(clean),
      );
      const userDeniedEscalation = Boolean(
        pendingEscalationPrompt && isNegative(clean),
      );
      const explicitHumanRequest = isExplicitHumanRequest(clean);

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

        const mappedSession = await decorateSessionIdentity(session);

        const payload = {
          session: mappedSession,
          message: mapMessage(userMsg),
        };

        emitToSupportAdmins("admin-support:message", payload);
        emitToSupportAdmins("admin-support:session-updated", {
          session: mappedSession,
        });
        emitToSupportUser(String(session.userUid), "support:message", payload);
        emitToSupportSession(String(session._id), "support:message", payload);

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg)],
        });
      }

      if (userDeniedEscalation) {
        if (pendingEscalationPrompt) {
          await SupportMessage.updateOne(
            { _id: pendingEscalationPrompt._id },
            {
              $set: {
                "meta.confirmEscalation": false,
                "meta.confirmationResolvedAt": new Date(),
              },
            },
          );
        }

        const botMsg = await SupportMessage.create({
          sessionId: session._id,
          sender: "assistant",
          text: "Okay, I’ll continue helping you here. What else can I assist you with?",
          meta: { continuedFromEscalation: true },
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

        const mappedSession = await decorateSessionIdentity(session);

        const payloads = [
          {
            session: mappedSession,
            message: mapMessage(userMsg),
          },
          {
            session: mappedSession,
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
          session: mappedSession,
        });
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mappedSession,
        });

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(botMsg)],
        });
      }

      if (userWantsEscalationNow || explicitHumanRequest) {
        if (pendingEscalationPrompt) {
          await SupportMessage.updateOne(
            { _id: pendingEscalationPrompt._id },
            {
              $set: {
                "meta.confirmEscalation": false,
                "meta.confirmationResolvedAt": new Date(),
              },
            },
          );
        }

        const handoffMsg = await SupportMessage.create({
          sessionId: session._id,
          sender: "assistant",
          text: "I’ve sent this to our human support team. Replies will appear here as soon as an agent responds.",
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

        const mappedSession = await decorateSessionIdentity(session);

        const userPayload = {
          session: mappedSession,
          message: mapMessage(userMsg),
        };

        const handoffPayload = {
          session: mappedSession,
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
          session: mappedSession,
        });
        emitToSupportSession(
          String(session._id),
          "support:message",
          userPayload,
        );
        emitToSupportSession(
          String(session._id),
          "support:message",
          handoffPayload,
        );
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mappedSession,
        });

        emitToSupportAdmins("admin-support:escalated", {
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
        });
        emitToSupportAdmins("admin-support:session-updated", {
          session: mappedSession,
        });

        await createAdminEscalationNotifications(session, userMsg, handoffMsg);
        await notifyAdminsOfEscalation(session, userMsg, handoffMsg);

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
        });
      }

      const historyDocs = await SupportMessage.find({ sessionId: session._id })
        .sort({ createdAt: 1 })
        .limit(20);

      let triage;
      try {
        const aiContext = await buildSupportAiContext(req, session);

        triage = await getSupportDecision({
          text: clean,
          history: historyDocs.map((m) => ({
            sender: m.sender,
            text: m.text,
          })),
          context: aiContext,
        });
      } catch (err) {
        console.error("[support-ai] failed:", err?.message || err);
        triage = {
          type: "bot_reply",
          text: "I’m here to help. Can you tell me more about your issue, or would you like me to connect you with a human support specialist?",
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

        const mappedSession = await decorateSessionIdentity(session);

        const payloads = [
          {
            session: mappedSession,
            message: mapMessage(userMsg),
          },
          {
            session: mappedSession,
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
          session: mappedSession,
        });
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mappedSession,
        });

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(botMsg)],
        });
      }

      if (triage.type === "escalate" && triage.confirmEscalation !== true) {
        const confirmationText =
          "I can keep helping you here. Would you like me to connect you with a human support specialist?";

        const confirmationMsg = await SupportMessage.create({
          sessionId: session._id,
          sender: "assistant",
          text: confirmationText,
          meta: {
            confirmEscalation: true,
            autoEscalationFallback: true,
            originalEscalationText: String(triage.text || "").trim(),
          },
          readAt: new Date(),
          deliveryStatus: "read",
        });

        session.mode = "bot";
        session.escalated = false;
        session.escalatedAt = null;
        session.lastMessageAt = confirmationMsg.createdAt;
        session.lastMessageText = confirmationMsg.text;
        session.lastSender = "assistant";
        await session.save();

        const mappedSession = await decorateSessionIdentity(session);

        const payloads = [
          {
            session: mappedSession,
            message: mapMessage(userMsg),
          },
          {
            session: mappedSession,
            message: mapMessage(confirmationMsg),
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
          session: mappedSession,
        });
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mappedSession,
        });

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(confirmationMsg)],
        });
      }

      if (triage.type === "escalate" && triage.confirmEscalation === true) {
        const confirmationMsg = await SupportMessage.create({
          sessionId: session._id,
          sender: "assistant",
          text: triage.text,
          meta: { confirmEscalation: true },
          readAt: new Date(),
          deliveryStatus: "read",
        });

        session.mode = "bot";
        session.escalated = false;
        session.escalatedAt = null;
        session.lastMessageAt = confirmationMsg.createdAt;
        session.lastMessageText = confirmationMsg.text;
        session.lastSender = "assistant";
        await session.save();

        const mappedSession = await decorateSessionIdentity(session);

        const payloads = [
          {
            session: mappedSession,
            message: mapMessage(userMsg),
          },
          {
            session: mappedSession,
            message: mapMessage(confirmationMsg),
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
          session: mappedSession,
        });
        emitToSupportSession(String(session._id), "support:session-updated", {
          session: mappedSession,
        });

        return res.json({
          ok: true,
          session: mappedSession,
          messages: [mapMessage(userMsg), mapMessage(confirmationMsg)],
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

      const mappedSession = await decorateSessionIdentity(session);

      const userPayload = {
        session: mappedSession,
        message: mapMessage(userMsg),
      };

      const handoffPayload = {
        session: mappedSession,
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
        session: mappedSession,
      });

      emitToSupportSession(String(session._id), "support:message", userPayload);
      emitToSupportSession(
        String(session._id),
        "support:message",
        handoffPayload,
      );
      emitToSupportSession(String(session._id), "support:session-updated", {
        session: mappedSession,
      });

      emitToSupportAdmins("admin-support:escalated", {
        session: mappedSession,
        messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
      });
      emitToSupportAdmins("admin-support:session-updated", {
        session: mappedSession,
      });

      await createAdminEscalationNotifications(session, userMsg, handoffMsg);
      await notifyAdminsOfEscalation(session, userMsg, handoffMsg);

      return res.json({
        ok: true,
        session: mappedSession,
        messages: [mapMessage(userMsg), mapMessage(handoffMsg)],
      });
    } catch (err) {
      console.error("[support/messages:post] failed:", err?.message || err);
      return res.status(500).json({ error: "support_send_failed" });
    }
  });

  return router;
}
