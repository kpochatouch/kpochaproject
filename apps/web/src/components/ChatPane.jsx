import { useEffect, useRef, useState } from "react";
import { api, markRoomRead } from "../lib/api";

export default function ChatPane({
  socket,
  room,
  me,                // label (e.g. displayName or email)
  toUid = null,      // ✅ DM target (for /chat); omit for booking chat
  initialMessages = [],
}) {
  const [msgs, setMsgs] = useState(initialMessages);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const endRef = useRef(null);

  // reset list when room / initial messages change
  useEffect(() => {
    setMsgs(initialMessages || []);
  }, [room, initialMessages]);

  // Mark room as read when we open it or when room changes
  useEffect(() => {
    if (!room) return;
    (async () => {
      try {
        await markRoomRead(room);
      } catch (e) {
        // silent fail – not critical for chat itself
        console.warn("[chat] markRoomRead failed:", e?.message || e);
      }
    })();
  }, [room]);

  // Listen for incoming messages
  useEffect(() => {
    if (!socket) return;

    function onMsg(m) {
      const body = m.body ?? m.text ?? m.message ?? "";
      const from =
        m.fromUid ||
        m.from ||
        m.sender ||
        "peer";
      const at = m.createdAt || m.at || m.ts || Date.now();
      const meta = m.meta || {};

      const normalized = { ...m, body, from, at, meta };
      setMsgs((x) => [...x, normalized]);
    }

    socket.on("chat:message", onMsg);
    return () => {
      socket.off("chat:message", onMsg);
    };
  }, [socket]);

  // auto scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function uploadFileToCloudinary(file) {
    const { data: sign } = await api.post("/api/uploads/sign", {
      folder: "kpocha/chat",
      overwrite: false,
      tags: ["chat"],
    });

    if (!sign?.cloudName || !sign?.apiKey || !sign?.signature) {
      throw new Error("cloudinary_sign_failed");
    }

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sign.apiKey);
    form.append("timestamp", sign.timestamp);
    form.append("signature", sign.signature);
    form.append("folder", sign.folder || "kpocha/chat");
    if (sign.public_id) form.append("public_id", sign.public_id);
    if (typeof sign.overwrite !== "undefined") {
      form.append("overwrite", String(sign.overwrite));
    }
    if (sign.tags) form.append("tags", sign.tags);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${sign.cloudName}/auto/upload`;
    const res = await fetch(uploadUrl, { method: "POST", body: form });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`cloudinary_upload_failed: ${errText}`);
    }

    const json = await res.json();
    const url = json.secure_url || json.url;
    if (!url) throw new Error("no_secure_url_from_cloudinary");
    return url;
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

      const payload = {
        room,
        from: me,
        body: "",
        ts: now,
        meta: { attachments: [attachment] },
        ...(toUid ? { toUid } : {}), // ✅ DM target if provided
      };

      setMsgs((x) => [...x, { ...payload, at: now }]);
      socket.emit("chat:message", payload);
    } catch (err) {
      console.error("chat upload failed:", err);
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function send() {
    const body = text.trim();
    if (!body || !socket || !room) return;

    const now = Date.now();
    const payload = {
      room,
      from: me,
      body,
      ts: now,
      ...(toUid ? { toUid } : {}), // ✅ DM target if provided
    };

    setMsgs((x) => [...x, { ...payload, at: now }]);
    socket.emit("chat:message", payload);
    setText("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-2 p-3 border border-zinc-800 rounded-xl">
        {msgs.map((m, i) => {
          const isMe = m.from === me || m.isMe === true;
          const meta = m.meta || {};
          const attachments = Array.isArray(meta.attachments)
            ? meta.attachments
            : meta.attachment
            ? [meta.attachment]
            : [];

          return (
            <div
              key={i}
              className={`max-w-[80%] px-3 py-2 rounded-xl ${
                isMe ? "bg-zinc-800 ml-auto" : "bg-zinc-900"
              }`}
            >
              <div className="text-xs text-zinc-400">
                {isMe ? "You" : m.from}
              </div>

              {m.body && (
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
              )}

              {attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {attachments.map((att, idx) => {
                    if (!att || !att.url) return null;
                    const attType = att.type || "";
                    const name = att.name || "Attachment";

                    if (attType.startsWith("image")) {
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

                    if (attType.startsWith("video")) {
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
