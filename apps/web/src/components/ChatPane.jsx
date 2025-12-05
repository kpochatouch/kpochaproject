// apps/web/src/components/ChatPane.jsx
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

function generateClientId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function ChatPane({
  socket,
  room,
  meUid = null,      // authoritative uid (pass from Chat.jsx)
  myLabel = "You",   // optional display label
  toUid = null,
  peerUid = null,         // NEW
  peerProfile = null,     // NEW: { displayName, avatarUrl }
  initialMessages = [],
}) {
  const [msgs, setMsgs] = useState(initialMessages || []);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    setMsgs(initialMessages || []);
  }, [room, initialMessages]);

  // mark room read (when room changes)
  useEffect(() => {
    if (!room) return;
    (async () => {
      try {
        await api.put(`/api/chat/room/${encodeURIComponent(room)}/read`);
      } catch (e) {
        // ignore
      }
    })();
  }, [room]);

  // Listen for incoming messages and normalize them
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
      return { id, clientId, room: m.room, body, fromUid, sender, at, meta, isMe };
    }

    function onMsg(m) {
      const n = normalizeIncoming(m);

      setMsgs((prev) => {
        // 1) if server returned clientId and we have optimistic msg => replace it
        if (n.clientId) {
          const idx = prev.findIndex(
            (x) => x.clientId && x.clientId === n.clientId
          );
          if (idx !== -1) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...n, _confirmed: true };
            return copy;
          }
        }

        // 2) avoid exact id dupes
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

    socket.on("chat:message", onMsg);

    // debug log (temporary) — comment out if noisy
    socket.on("chat:debug", (d) => console.debug("[chat:debug]", d));

    return () => {
      try {
        socket.off("chat:message", onMsg);
      } catch {}
    };
  }, [socket, meUid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

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

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !socket || !room) return;

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
      const payload = {
        room,
        body: "",
        clientId,
        ts: now,
        meta: { attachments: [attachment] },
        ...(toUid ? { toUid } : {}),
      };

      // optimistic UI
      setMsgs((x) => [
        ...x,
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
        },
      ]);

      socket.emit("chat:message", payload);
    } catch (err) {
      console.error("upload failed", err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function send() {
    const body = String(text || "").trim();
    if (!body || !socket || !room) return;

    const now = Date.now();
    const clientId = generateClientId();
    const payload = {
      room,
      body,
      clientId,
      ts: now,
      ...(toUid ? { toUid } : {}),
    };

    // optimistic UI
    setMsgs((x) => [
      ...x,
      {
        id: `local:${clientId}`,
        clientId,
        room,
        body,
        fromUid: meUid || null,
        sender: { displayName: myLabel || "You" },
        at: now,
        meta: {},
        isMe: true,
        _optimistic: true,
      },
    ]);

    socket.emit("chat:message", payload);
    setText("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-2 p-3 border border-zinc-800 rounded-xl">
        {msgs.map((m, i) => {
          const isMe = Boolean(m.isMe);
          const attachments = Array.isArray(m.meta?.attachments)
            ? m.meta.attachments
            : [];

          // ---------- decide which name + avatar to show ----------
          let displayName;
          let avatarUrl = "";

          if (isMe) {
            // for my own messages, always "You"
            displayName = "You";
          } else if (m.sender && (m.sender.displayName || m.sender.name)) {
            // trust backend-enriched sender object when present
            displayName = m.sender.displayName || m.sender.name;
            avatarUrl = m.sender.avatarUrl || m.sender.photoUrl || "";
          } else if (
            peerProfile &&
            (!peerUid || !m.fromUid || m.fromUid === peerUid)
          ) {
            // fallback: we know this is a DM and have peer profile from Chat header
            displayName =
              peerProfile.displayName ||
              peerProfile.fullName ||
              peerProfile.username ||
              "Unknown";
            avatarUrl = peerProfile.avatarUrl || peerProfile.photoUrl || "";
          } else {
            // truly unknown (should be rare in your system)
            displayName = "Unknown";
          }

          const initial =
            displayName && displayName.length
              ? displayName.slice(0, 1).toUpperCase()
              : "?";

          return (
            <div
              key={m.id || i}
              className={`flex ${
                isMe ? "justify-end" : "justify-start"
              }`}
            >
              {/* peer avatar on the left for their messages */}
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
                className={`max-w-[80%] px-3 py-2 rounded-xl ${
                  isMe ? "bg-zinc-800 ml-2" : "bg-zinc-900"
                }`}
                data-chat-message
              >
                <div className="text-xs text-zinc-400">{displayName}</div>

                {m.body && (
                  <div className="text-sm whitespace-pre-wrap">{m.body}</div>
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
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="mt-2 flex gap-2 items-center">
        <label className="text-xs px-3 py-2 rounded-lg border border-zinc-800 cursor-pointer">
          {uploading ? "Uploading…" : "Attach file"}
          <input
            type="file"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>

        <input
          className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
        />
        <button
          className="px-4 py-2 rounded-lg bg-gold text-black font-semibold"
          onClick={send}
          type="button"
        >
          Send
        </button>
      </div>
    </div>
  );
}
