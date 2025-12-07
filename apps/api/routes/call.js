// apps/api/routes/call.js
import express from "express";
import mongoose from "mongoose";
import * as callService from "../services/callService.js";
import { getCallById, listRecentCallsForUser, getActiveCallForUser } from "../services/callService.js";

export default function callRoutes({ requireAuth }) {
  const router = express.Router();

  /** ----------------------------------------------------
   *  POST /api/call
   *  Create a new call using callService (recommended)
   * ----------------------------------------------------*/
  router.post("/call", requireAuth, async (req, res) => {
    try {
      const callerUid = req.user.uid;
      const { receiverUid, callType = "audio", meta = {} } = req.body || {};

      if (!receiverUid) {
        return res.status(400).json({ error: "receiverUid_required" });
      }

      const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const room = `call:${callId}`;

      // use the central callService
      const call = await callService.createCall({
        callId,
        room,
        callerUid,
        receiverUids: [receiverUid],
        callType,
        meta
      });

            return res.json({
        ok: true,
        id: String(call._id),
        callId: call.callId,
        room: call.room,
        callType: call.callType,
      });

    } catch (err) {
      console.error("[POST /api/call] error:", err?.message || err);
      return res.status(500).json({ error: "call_create_failed" });
    }
  });

  /** ----------------------------------------------------
   *  GET /api/call/:id
   * ----------------------------------------------------*/
  router.get("/call/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "id_required" });

      const rec = await getCallById(id);
      if (!rec) return res.status(404).json({ error: "call_not_found" });

      const uid = req.user.uid;
      if (!rec.participants?.some((p) => p.uid === uid)) {
        return res.status(403).json({ error: "not_allowed" });
      }

      return res.json({ ok: true, item: rec });

    } catch (err) {
      console.error("[GET /api/call/:id] error:", err?.message || err);
      return res.status(500).json({ error: "call_fetch_failed" });
    }
  });

  /** ----------------------------------------------------
   *  GET /api/calls
   *  List calls for logged-in user
   * ----------------------------------------------------*/
  router.get("/calls", requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const limit = Number(req.query.limit || 50);

      const list = await listRecentCallsForUser(uid, { limit });

      return res.json({ items: list });

    } catch (err) {
      console.error("[GET /api/calls] error:", err?.message || err);
      return res.status(500).json({ error: "calls_list_failed" });
    }
  });

  /** ----------------------------------------------------
   *  GET /api/call/active
   *  Return active (not ended) call for the user
   * ----------------------------------------------------*/
  router.get("/call/active", requireAuth, async (req, res) => {
    try {
      const uid = req.user.uid;
      const call = await getActiveCallForUser(uid);
      return res.json({ item: call || null });
    } catch (err) {
      console.error("[GET /api/call/active] error:", err?.message || err);
      return res.status(500).json({ error: "active_call_failed" });
    }
  });

  /** ----------------------------------------------------
   *  PUT /api/call/:id/status
   *  Use callService.updateCallStatus()
   * ----------------------------------------------------*/
  router.put("/call/:id/status", requireAuth, async (req, res) => {
    try {
      const callId = String(req.params.id || "").trim();
      const { status, meta } = req.body || {};

      if (!status) return res.status(400).json({ error: "status_required" });

      const updated = await callService.updateCallStatus(callId, {
        status,
        meta
      });

      return res.json({ ok: true });

    } catch (err) {
      console.error("[PUT /api/call/:id/status] error:", err?.message || err);
      return res.status(500).json({ error: "call_status_failed" });
    }
  });

  /** ----------------------------------------------------
   *  DELETE /api/call/:id
   * ----------------------------------------------------*/
  router.delete("/call/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "id_required" });

      const rec = await getCallById(id);
      if (!rec) return res.status(404).json({ error: "call_not_found" });

      const uid = req.user.uid;
      if (!rec.participants?.some((p) => p.uid === uid)) {
        return res.status(403).json({ error: "not_allowed" });
      }

      await mongoose.model("CallRecord").deleteOne({ callId: rec.callId });

      return res.json({ ok: true });

    } catch (err) {
      console.error("[DELETE /api/call/:id] error:", err?.message || err);
      return res.status(500).json({ error: "call_delete_failed" });
    }
  });

  return router;
}
