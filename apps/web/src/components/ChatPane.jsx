// apps/web/src/components/ChatPane.jsx
import { useEffect, useRef, useState } from "react";
import { api, sendChatMessage } from "../lib/api";
import VoiceInputButton from "./VoiceInputButton.jsx";
import VoiceMessageButton from "./VoiceMessageButton.jsx";

const isMobileDevice =
  typeof navigator !== "undefined" &&
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function generateClientId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function sameDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatTimeLabel(at) {
  const d = toDate(at);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(at) {
  const d = toDate(at);
  if (!d) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";

  return d.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/* ---------- helpers to read stars/pins/reactions from message ---------- */
function isMsgStarred(m, meUid) {
  if (!meUid) return false;
  const arr = Array.isArray(m.starredBy) ? m.starredBy : [];
  return arr.includes(meUid);
}

function isMsgPinned(m, meUid) {
  if (!meUid) return false;
  const arr = Array.isArray(m.pinnedBy) ? m.pinnedBy : [];
  return arr.includes(meUid);
}

function getMyReaction(m, meUid) {
  if (!meUid || !Array.isArray(m.reactions)) return null;
  const r = m.reactions.find((x) => x && x.uid === meUid);
  return r ? r.emoji : null;
}

function summarizeCallBubble(callMeta, isMe) {
  const typeLabel = callMeta.type === "video" ? "Video call" : "Voice call";
  const status = callMeta.status || "";
  const direction = callMeta.direction || (isMe ? "outgoing" : "incoming");

  if (status === "missed") {
    return direction === "outgoing"
      ? `Missed ${typeLabel} (you called)`
      : `Missed ${typeLabel}`;
  }

  if (status === "ended" || status === "accepted") {
    return direction === "outgoing"
      ? `${typeLabel} (you called)`
      : `${typeLabel} (they called you)`;
  }

  if (status === "cancelled") {
    return direction === "outgoing"
      ? `Cancelled ${typeLabel}`
      : `Missed ${typeLabel}`;
  }

  if (status === "declined") {
    return `Declined ${typeLabel}`;
  }

  if (status === "dialing" || status === "ringing") {
    return `${typeLabel} · calling…`;
  }

  return typeLabel;
}


export default function ChatPane({
  socket,
  room,
  meUid = null,
  myLabel = "You",
  toUid = null,
  peerUid = null,
  peerProfile = null,
  initialMessages = [],
}) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);

  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const [composerFocused, setComposerFocused] = useState(false);

const hideSideButtonsOnMobile = isMobileDevice && composerFocused;


  // menu / actions state
  const [menu, setMenu] = useState(null); // { x, y, msg }
  const longPressTimerRef = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // ---------- hydrate initial messages with proper status ----------
  useEffect(() => {
    const normalized = (initialMessages || []).map((m) => {
      let status = m.status;

      if (!status) {
        if (m.isMe) {
          const seen =
            Array.isArray(m.seenBy) &&
            peerUid &&
            m.seenBy.includes(peerUid);
          status = seen ? "seen" : "delivered";
        } else {
          status = "received";
        }
      }

      return { ...m, status };
    });
    setMsgs(normalized);
  }, [room, initialMessages, peerUid]);

  useEffect(() => {
  if (!socket || !room) return;
  socket.emit("chat:read", { room });
}, [socket, room]);

  // ---------- socket listeners ----------
  useEffect(() => {
    if (!socket) return;

    function normalizeIncoming(m) {
      const fromUid = m.fromUid || m.from || null;
      const id =
        m.id ||
        m._id ||
        `srv:${fromUid || "x"}:${m.createdAt || m.ts || Date.now()}`;
      const clientId = m.clientId || null;
      const sender = m.sender || null;
      const body = m.body || m.text || "";
      const at = m.createdAt || m.ts || Date.now();
      const meta = m.meta || { attachments: m.attachments || [] };
      const isMe = Boolean(fromUid && meUid && fromUid === meUid);
      const seenBy = Array.isArray(m.seenBy) ? m.seenBy : [];

      const starredBy = Array.isArray(m.starredBy) ? m.starredBy : [];
      const pinnedBy = Array.isArray(m.pinnedBy) ? m.pinnedBy : [];
      const reactions = Array.isArray(m.reactions) ? m.reactions : [];

      let status;
      if (isMe) {
        const seen =
          peerUid && Array.isArray(seenBy) && seenBy.includes(peerUid);
        status = seen ? "seen" : "delivered";
      } else {
        status = "received";
      }

      return {
        id,
        clientId,
        room: m.room,
        body,
        fromUid,
        sender,
        at,
        meta,
        isMe,
        seenBy,
        status,
        starredBy,
        pinnedBy,
        reactions,
      };
    }

   function onMsg(m) {
  const n = normalizeIncoming(m);

  // ✅ emit outside setState (side-effect safe)
  if (!n.isMe && n.room === room) {
    socket.emit("chat:read", { room });
  }

  setMsgs((prev) => {
    // reconcile optimistic message by clientId
    if (n.clientId) {
      const idx = prev.findIndex(
        (x) => x.clientId && x.clientId === n.clientId
      );
      if (idx !== -1) {
        const copy = [...prev];
        const existing = copy[idx];

        let nextStatus = n.status;
        const order = ["pending", "sent", "delivered", "seen"];
        if (existing.isMe) {
          const existingRank = order.indexOf(existing.status || "pending");
          const incomingRank = order.indexOf(n.status || "pending");
          if (existingRank > incomingRank) nextStatus = existing.status;
        }

        copy[idx] = { ...existing, ...n, _confirmed: true, status: nextStatus };
        return copy;
      }
    }

    if (
      prev.some(
        (x) => x.id === n.id || (n.clientId && x.clientId === n.clientId)
      )
    ) {
      return prev;
    }

    return [...prev, n];
  });
}


    // live "seen" listener
    function onSeen(evt) {
      if (!evt || !evt.room || !evt.seenBy) return;
      if (evt.room !== room) return;

      const viewerUid = evt.seenBy;

      setMsgs((prev) => {
        if (!peerUid || viewerUid !== peerUid) return prev;

        const order = ["pending", "sent", "delivered", "seen"];
        const seenRank = order.indexOf("seen");

        return prev.map((m) => {
          if (!m.isMe) return m;

          const currentRank = order.indexOf(m.status || "pending");
          if (currentRank >= seenRank) return m;

          const nextSeenBy = Array.isArray(m.seenBy)
            ? Array.from(new Set([...m.seenBy, viewerUid]))
            : [viewerUid];

          return {
            ...m,
            status: "seen",
            seenBy: nextSeenBy,
          };
        });
      });
    }

    socket.on("chat:message", onMsg);
    socket.on("chat:update", onMsg);
    socket.on("chat:seen", onSeen);

    return () => {
      try {
        socket.off("chat:message", onMsg);
        socket.off("chat:update", onMsg);
        socket.off("chat:seen", onSeen);
      } catch {}
    };
  }, [socket, meUid, peerUid, room]);

  // ---------- auto scroll ---------->
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ---------- auto-grow textarea ---------->
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 7 * 22;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [text]);

  // ---------- uploads ----------
  async function uploadFileToCloudinary(file) {
    const { data: sign } = await api.post("/api/uploads/sign", {
      folder: "kpocha/chat",
      overwrite: false,
      tags: ["chat"],
    });

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sign.apiKey);
    form.append("timestamp", sign.timestamp);
    form.append("signature", sign.signature);
    form.append("folder", sign.folder || "kpocha/chat");
    if (sign.public_id) form.append("public_id", sign.public_id);
    if (sign.tags) form.append("tags", sign.tags);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${sign.cloudName}/auto/upload`,
      {
        method: "POST",
        body: form,
      }
    );

    if (!res.ok) throw new Error("cloudinary_upload_failed");
    const json = await res.json();
    return json.secure_url || json.url;
  }

  async function uploadAudioBlob(blob) {
    const file = new File([blob], `voice-${Date.now()}.webm`, {
      type: blob.type || "audio/webm",
    });
    return uploadFileToCloudinary(file);
  }

  async function handleFileChange(e) {
  const file = e.target.files?.[0];
  // ⛔ stop using socket as a gate
  if (!file || !room) return;

  try {
    setUploading(true);
    const url = await uploadFileToCloudinary(file);
    const now = Date.now();
    const attachment = {
      url,
      type: file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
        ? "video"
        : "file",
      name: file.name,
      size: file.size,
    };

    const clientId = generateClientId();

    // optimistic bubble
    setMsgs((prev) => [
      ...prev,
      {
        id: `local:${clientId}`,
        clientId,
        room,
        body: "",
        fromUid: meUid || null,
        sender: { displayName: myLabel || "You" },
        at: now,
        meta: { attachments: [attachment] },
        isMe: true,
        _optimistic: true,
        status: "pending",
        seenBy: meUid ? [meUid] : [],
      },
    ]);

    // ✅ reliable send (socket first, REST fallback)
    let ok = false;
    try {
      const res = await sendChatMessage({
        room,
        text: "",
        meta: { attachments: [attachment] },
        clientId,
      });
      ok = !res || res.ok !== false;
    } catch (err) {
      console.error("send attachment failed:", err);
      ok = false;
    }

    const order = ["pending", "sent", "delivered", "seen"];
    const sentRank = order.indexOf("sent");

    setMsgs((prev) =>
      prev.map((m) => {
        if (m.clientId !== clientId || !m.isMe) return m;
        if (!ok) return { ...m, status: "failed" };

        const currentRank = order.indexOf(m.status || "pending");
        if (currentRank >= sentRank) return m;
        return { ...m, status: "sent" };
      })
    );
  } catch (err) {
    console.error("upload failed", err);
    alert("Upload failed");
  } finally {
    setUploading(false);
    e.target.value = "";
  }
}

  async function handleVoiceMessage(blob) {
  if (!blob || !room) return;

  const now = Date.now();
  const clientId = generateClientId();

  try {
    setUploading(true);

    const url = await uploadAudioBlob(blob);

    const attachment = {
      url,
      type: "audio",
      name: `Voice message ${new Date(now).toLocaleString()}`,
      size: blob.size || 0,
    };

    // optimistic bubble
    setMsgs((prev) => [
      ...prev,
      {
        id: `local:${clientId}`,
        clientId,
        room,
        body: "",
        fromUid: meUid || null,
        sender: { displayName: myLabel || "You" },
        at: now,
        meta: { attachments: [attachment] },
        isMe: true,
        _optimistic: true,
        status: "pending",
        seenBy: meUid ? [meUid] : [],
      },
    ]);

    // ✅ reliable send
    let ok = false;
    try {
      const res = await sendChatMessage({
        room,
        text: "",
        meta: { attachments: [attachment] },
        clientId,
      });
      ok = !res || res.ok !== false;
    } catch (e) {
      console.error("voice message send failed", e);
      ok = false;
    }

    const order = ["pending", "sent", "delivered", "seen"];
    const sentRank = order.indexOf("sent");

    setMsgs((prev) =>
      prev.map((m) => {
        if (m.clientId !== clientId || !m.isMe) return m;
        if (!ok) return { ...m, status: "failed" };

        const currentRank = order.indexOf(m.status || "pending");
        if (currentRank >= sentRank) return m;
        return { ...m, status: "sent" };
      })
    );
  } catch (e) {
    console.error("voice message upload failed", e);
    alert("Voice upload failed");
    setMsgs((prev) =>
      prev.map((m) =>
        m.clientId === clientId ? { ...m, status: "failed" } : m
      )
    );
  } finally {
    setUploading(false);
  }
}


  // ---------- text send ----------
  async function send() {
  const body = String(text || "").trim();
  if (!body || !room) return;

  const now = Date.now();
  const clientId = generateClientId();

  const meta =
    replyTo && replyTo.id
      ? {
          replyTo: {
            id: replyTo.id,
            fromUid: replyTo.fromUid,
            body: replyTo.body?.slice(0, 200) || "",
          },
        }
      : {};

  // optimistic bubble
  setMsgs((prev) => [
    ...prev,
    {
      id: `local:${clientId}`,
      clientId,
      room,
      body,
      fromUid: meUid || null,
      sender: { displayName: myLabel || "You" },
      at: now,
      meta,
      isMe: true,
      _optimistic: true,
      status: "pending",
      seenBy: meUid ? [meUid] : [],
    },
  ]);

  let ok = false;

  try {
    const res = await sendChatMessage({
      room,
      text: body,
      meta,
      clientId,
    });
    console.log("chat:message result =", res);
    ok = !res || res.ok !== false;
  } catch (err) {
    console.error("chat:message send failed:", err);
    ok = false;
  }

  const order = ["pending", "sent", "delivered", "seen"];
  const sentRank = order.indexOf("sent");

  setMsgs((prev) =>
    prev.map((m) => {
      if (m.clientId !== clientId || !m.isMe) return m;
      if (!ok) return { ...m, status: "failed" };

      const currentRank = order.indexOf(m.status || "pending");
      if (currentRank >= sentRank) return m;
      return { ...m, status: "sent" };
    })
  );

  setText("");
  setReplyTo(null);
}

  // ---------- keyboard: Enter vs newline ----------
  // Mobile: Enter = newline (use button to send)
  // Desktop: Enter = send, Shift+Enter = newline
  function handleKeyDown(e) {
    if (e.key !== "Enter") return;

    if (isMobileDevice) {
      // on phone, let Enter insert newline
      return;
    }

    if (e.shiftKey) {
      // desktop Shift+Enter = newline
      return;
    }

    e.preventDefault();
    send();
  }

  function handleVoiceResult(transcript) {
    if (!transcript) return;
    setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // ---------- context menu / long-press ----------
  function openMenu(e, msg) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      msg,
    });
  }

  function handleMouseDown(e, msg) {
    if (e.button === 2) return; // right click handled by onContextMenu
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      openMenu(e, msg);
    }, 600); // 0.6s hold
  }

  function handleMouseUp() {
    clearTimeout(longPressTimerRef.current);
  }

  function closeMenu() {
    setMenu(null);
  }

  // ----- menu actions -----
  async function handleCopy() {
    if (!menu?.msg?.body) return closeMenu();
    try {
      await navigator.clipboard?.writeText(menu.msg.body);
    } catch (e) {
      console.warn("clipboard failed", e);
    }
    closeMenu();
  }

  function handleReply() {
    if (!menu?.msg) return closeMenu();
    setReplyTo(menu.msg);
    closeMenu();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleForward() {
    if (!menu?.msg) return closeMenu();
    const body = menu.msg.body || "";
    setText((prev) => (prev ? `${prev}\n\n${body}` : body));
    closeMenu();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function handleToggleStar() {
    if (!menu?.msg?.id) return closeMenu();
    const id = menu.msg.id;
    closeMenu();
    try {
      const { data } = await api.post(`/api/chat/message/${id}/star`);
      const updated = data?.message || data;
      if (updated) {
        setMsgs((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...updated } : m))
        );
      }
    } catch (e) {
      console.warn("toggle star failed", e);
    }
  }

  async function handlePin() {
    if (!menu?.msg?.id) return closeMenu();
    const id = menu.msg.id;
    closeMenu();
    try {
      const { data } = await api.post(`/api/chat/message/${id}/pin`);
      const updated = data?.message || data;
      if (updated) {
        setMsgs((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...updated } : m))
        );
      }
    } catch (e) {
      console.warn("toggle pin failed", e);
    }
  }

  async function handleDeleteForMe() {
    if (!menu?.msg?.id) return closeMenu();
    const id = menu.msg.id;
    closeMenu();
    try {
      await api.post(`/api/chat/message/${id}/delete-for-me`);
      setMsgs((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      console.warn("delete-for-me failed", e);
    }
  }

  function handleSelect() {
    if (!menu?.msg?.id) return closeMenu();
    const id = menu.msg.id;
    setSelectMode(true);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    closeMenu();
  }

  async function handleShare() {
    if (!menu?.msg?.body) return closeMenu();
    const textToShare = menu.msg.body;
    try {
      if (navigator.share) {
        await navigator.share({ text: textToShare });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(textToShare);
      }
    } catch (e) {
      console.warn("share failed", e);
    }
    closeMenu();
  }

  async function handleReact(emoji) {
    if (!menu?.msg?.id) return closeMenu();
    const id = menu.msg.id;
    closeMenu();
    try {
      const { data } = await api.post(`/api/chat/message/${id}/react`, {
        emoji,
      });
      const updated = data?.message || data;
      if (updated) {
        setMsgs((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...updated } : m))
        );
      }
    } catch (e) {
      console.warn("reaction failed", e);
    }
  }

  function toggleSelectedForClick(id) {
    if (!selectMode) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 p-3 border border-zinc-800 rounded-xl no-scrollbar">
        {msgs.map((m, i) => {
          const isMe = Boolean(m.isMe);
          const attachments = Array.isArray(m.meta?.attachments)
            ? m.meta.attachments
            : [];
          const isStarred = isMsgStarred(m, meUid);
          const isPinned = isMsgPinned(m, meUid);
          const isSelected = selectedIds.includes(m.id);
          const reaction = getMyReaction(m, meUid);

          let displayName;
          let avatarUrl = "";

          if (isMe) {
            displayName = "You";
          } else if (m.sender && (m.sender.displayName || m.sender.name)) {
            displayName = m.sender.displayName || m.sender.name;
            avatarUrl = m.sender.avatarUrl || m.sender.photoUrl || "";
          } else if (
            peerProfile &&
            (!peerUid || !m.fromUid || m.fromUid === peerUid)
          ) {
            displayName =
              peerProfile.displayName ||
              peerProfile.fullName ||
              peerProfile.username ||
              "Unknown";
            avatarUrl = peerProfile.avatarUrl || peerProfile.photoUrl || "";
          } else {
            displayName = "Unknown";
          }

          const initial =
            displayName && displayName.length
              ? displayName.slice(0, 1).toUpperCase()
              : "?";

          const timeLabel = formatTimeLabel(m.at);
          const dateLabel = formatDateLabel(m.at);
          const prev = i > 0 ? msgs[i - 1] : null;
          const showDateHeader = !prev || !sameDay(prev?.at, m.at);

          let statusNode = null;
          if (isMe) {
            if (m.status === "pending") {
              statusNode = (
                <span className="text-zinc-500 text-[10px]">sending…</span>
              );
            } else if (m.status === "failed") {
              statusNode = (
                <span className="text-red-500 text-[10px]">⟳ failed</span>
              );
            } else if (m.status === "sent") {
              statusNode = (
                <span className="text-zinc-400 text-[11px]">✓</span>
              );
            } else if (m.status === "delivered") {
              statusNode = (
                <span className="text-zinc-100 text-[11px]">✓✓</span>
              );
            } else if (m.status === "seen") {
              statusNode = (
                <span className="text-amber-400 text-[11px]">✓✓</span>
              );
            }
          }

              const callMeta = m.meta?.call || null;

          // If this message is a call event → show a centered system bubble
          if (callMeta) {
            const label = summarizeCallBubble(callMeta, isMe);

            return (
              <div key={m.id || i}>
                {showDateHeader && (
                  <div className="w-full flex justify-center my-2">
                    <span className="text-[10px] text-zinc-400 px-3 py-0.5 rounded-full bg-zinc-900/60">
                      {dateLabel}
                    </span>
                  </div>
                )}

                <div className="w-full flex justify-center my-2">
                  <div className="text-[11px] px-3 py-1 rounded-full bg-zinc-900/70 text-zinc-200 border border-zinc-700">
                    {label}
                  </div>
                </div>
              </div>
            );
          }



          return (
            <div key={m.id || i}>
              {showDateHeader && (
                <div className="w-full flex justify-center my-2">
                  <span className="text-[10px] text-zinc-400 px-3 py-0.5 rounded-full bg-zinc-900/60">
                    {dateLabel}
                  </span>
                </div>
              )}

              <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                {!isMe && (
                  <div className="mr-2 mt-1">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="w-8 h-8 rounded-full object-cover border border-zinc-700"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[11px]">
                        {initial}
                      </div>
                    )}
                  </div>
                )}

                <div
                  className={`max-w-[80%] px-3 py-2 rounded-xl relative ${
                    isMe ? "bg-zinc-800 ml-2" : "bg-zinc-900"
                  } ${isSelected ? "ring-2 ring-gold" : ""}`}
                  data-chat-message
                  onContextMenu={(e) => openMenu(e, m)}
                  onMouseDown={(e) => handleMouseDown(e, m)}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onClick={() => toggleSelectedForClick(m.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-400">{displayName}</div>
                    <div className="flex items-center gap-1 text-[10px]">
                      {isPinned && <span>📌</span>}
                      {isStarred && <span>⭐</span>}
                    </div>
                  </div>

                  {m.meta?.replyTo && (
                    <div className="mt-1 mb-1 border-l border-zinc-600 pl-2 text-[10px] text-zinc-400 line-clamp-2">
                      Replying to: {m.meta.replyTo.body}
                    </div>
                  )}
                  {m.body && (
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {m.body}
                    </div>
                  )}


                  {attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {attachments.map((att, idx) => {
                        if (!att || !att.url) return null;
                        const type = att.type || "";
                        const name = att.name || "Attachment";

                        if (type.startsWith("image")) {
                          return (
                            <a
                              key={idx}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-md overflow-hidden border border-zinc-700"
                            >
                              <img
                                src={att.url}
                                alt={name}
                                className="max-h-48 max-w-full object-cover"
                              />
                            </a>
                          );
                        }

                        if (type.startsWith("video")) {
                          return (
                            <video
                              key={idx}
                              src={att.url}
                              controls
                              className="max-h-48 max-w-full rounded-md border border-zinc-700"
                            />
                          );
                        }

                        if (type.startsWith("audio")) {
                          return (
                            <audio
                              key={idx}
                              src={att.url}
                              controls
                              className="w-full"
                            >
                              Your browser does not support audio playback.
                            </audio>
                          );
                        }

                        return (
                          <a
                            key={idx}
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline text-zinc-200 break-all"
                          >
                            {name}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {reaction && (
                    <div className="mt-1 text-xs">{reaction}</div>
                  )}

                  <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-zinc-400">
                    {timeLabel && <span>{timeLabel}</span>}
                    {statusNode}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {menu && (
        <div className="fixed inset-0 z-40" onClick={closeMenu}>
          <div
            className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-lg px-3 py-2 text-sm text-zinc-100 w-52"
            style={{ top: menu.y + 8, left: menu.x + 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleReply}
            >
              ↩ Reply
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleCopy}
            >
              📋 Copy
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleForward}
            >
              ➤ Forward
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleToggleStar}
            >
              ⭐ Star / Unstar
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handlePin}
            >
              📌 Pin / Unpin
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleDeleteForMe}
            >
              🗑 Delete for me
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleSelect}
            >
              ☑ Select
            </button>
            <button
              className="block w-full text-left py-1 text-xs hover:text-gold"
              onClick={handleShare}
            >
              📤 Share
            </button>

            <div className="mt-2 flex gap-1 pt-1 border-t border-zinc-700 text-lg">
              {["👍", "❤️", "😂", "😲", "😢", "🙏"].map((emo) => (
                <button
                  key={emo}
                  className="flex-1 text-center hover:scale-110 transition"
                  onClick={() => handleReact(emo)}
                >
                  {emo}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {replyTo && (
        <div className="mt-2 mx-1 px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-300 flex justify-between items-center">
          <div className="truncate">
            Replying to:{" "}
            <span className="font-semibold">
              {replyTo.sender?.displayName || "user"}
            </span>{" "}
            — {replyTo.body}
          </div>
          <button
            className="ml-2 text-xs text-zinc-400 hover:text-zinc-100"
            onClick={() => setReplyTo(null)}
          >
            ✕
          </button>
        </div>
      )}

      <div className="mt-2 flex gap-2 items-center">
      {/* Attach button – hidden on mobile when typing */}
      {!hideSideButtonsOnMobile && (
        <label
          className="flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-full border border-zinc-800 cursor-pointer text-lg"
          title="Attach image, video, or file"
        >
          {uploading ? "…" : "+"}
          <input
            type="file"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
      )}

      <textarea
        ref={textareaRef}
        className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm resize-none leading-snug"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setComposerFocused(true)}
        onBlur={() => setComposerFocused(false)}
        placeholder="Type a message…"
      />

      {/* Voice typing & voice note – hidden on mobile when typing */}
      {!hideSideButtonsOnMobile && (
        <>
          <div title="Voice typing (convert speech to text)">
            <VoiceInputButton
              onResult={handleVoiceResult}
              disabled={!room || !socket}
            />
          </div>

          <div title="Send voice note">
            <VoiceMessageButton
              onRecorded={handleVoiceMessage}
              disabled={!room || !socket || uploading}
            />
          </div>
        </>
      )}

      <button
        className="flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-full bg-gold text-black text-lg font-bold"
        onClick={send}
        type="button"
        disabled={!text.trim() || !room || uploading}
        title="Send message"
      >
        ↑
      </button>
      </div>
    </div>
  );
}
