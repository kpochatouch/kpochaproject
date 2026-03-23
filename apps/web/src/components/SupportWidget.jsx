//apps/web/src/components/SupportWidget.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  connectSocket,
  registerSocketHandler,
  supportGetSession,
  supportGetMessages,
  supportSendMessage,
} from "../lib/api";
import { useAuth } from "../context/AuthContext.jsx";

function byCreatedAt(a, b) {
  return Number(a.createdAt || 0) - Number(b.createdAt || 0);
}

function mergeMessages(prev, next) {
  const map = new Map();

  [...prev, ...next].forEach((m) => {
    if (!m?.id) return;
    map.set(String(m.id), m);
  });

  return [...map.values()].sort(byCreatedAt);
}

function supportHeader(session, messages) {
  if (session?.mode === "human") {
    const hasAgentReply = messages.some((m) => m.sender === "agent");
    if (hasAgentReply) {
      return {
        title: "Kpocha Support",
        subtitle: "A support agent is replying here",
      };
    }
    return {
      title: "Kpocha Support",
      subtitle: "Connecting you to support",
    };
  }

  return {
    title: "Kpocha Assistant",
    subtitle: "Quick support for common questions",
  };
}

export default function SupportWidget() {
  const { user, loading: authLoading } = useAuth();

  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const bodyRef = useRef(null);
  const bootstrappedRef = useRef(false);

  const header = useMemo(
    () => supportHeader(session, messages),
    [session, messages],
  );

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }
    });
  }

  async function bootstrap() {
    if (!user || bootstrappedRef.current) return;

    setLoading(true);
    setErr("");

    try {
      const sessionRes = await supportGetSession();
      const messagesRes = await supportGetMessages();

      setSession(sessionRes.session || messagesRes.session || null);
      setMessages(messagesRes.messages || []);
      bootstrappedRef.current = true;
      scrollToBottom();
    } catch (e) {
      setErr(e?.message || "Failed to load support.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onOpenSupport() {
      setOpen(true);
    }

    window.addEventListener("kpocha:open-support", onOpenSupport);
    return () => {
      window.removeEventListener("kpocha:open-support", onOpenSupport);
    };
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    bootstrap();
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;

    connectSocket();

    const offMessage = registerSocketHandler(
      "support:message",
      ({ session: nextSession, message } = {}) => {
        if (nextSession) setSession(nextSession);
        if (message) {
          setMessages((prev) => mergeMessages(prev, [message]));
          scrollToBottom();
        }
      },
    );

    const offSession = registerSocketHandler(
      "support:session-updated",
      ({ session: nextSession } = {}) => {
        if (nextSession) setSession(nextSession);
      },
    );

    return () => {
      offMessage();
      offSession();
    };
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    scrollToBottom();
  }, [messages, open]);

  useEffect(() => {
    if (!user) {
      setSession(null);
      setMessages([]);
      setText("");
      setSending(false);
      setLoading(false);
      setErr("");
      bootstrappedRef.current = false;
    }
  }, [user]);

  async function send() {
    const clean = text.trim();
    if (!clean || !user || sending) return;

    setSending(true);
    setErr("");
    setText("");

    try {
      const res = await supportSendMessage(clean);
      if (res.session) setSession(res.session);
      if (res.messages?.length) {
        setMessages((prev) => mergeMessages(prev, res.messages));
      }
      scrollToBottom();
    } catch (e) {
      setErr(e?.message || "Failed to send support message.");
    } finally {
      setSending(false);
    }
  }

  function onEnter(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed bottom-20 right-4 z-[120] w-[min(92vw,380px)] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
          style={{
            background: "var(--app-surface, #111)",
            color: "var(--app-text, #fff)",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div>
              <strong>{header.title}</strong>
              <div className="text-xs opacity-70">{header.subtitle}</div>
            </div>

            <button className="btn btnGhost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          {!authLoading ? (
            !user ? (
              <div
                ref={bodyRef}
                className="p-4 space-y-4 max-h-[55vh] overflow-y-auto"
              >
                <div className="msg bot">
                  Support chat is available for signed-in users. Please sign in
                  to continue.
                </div>

                <div className="flex gap-2">
                  <Link className="btn btnOutline" to="/login">
                    Login
                  </Link>
                  <Link className="btn btnPrimary" to="/client/register">
                    Sign Up
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div
                  ref={bodyRef}
                  className="p-4 space-y-3 max-h-[55vh] overflow-y-auto"
                >
                  {err ? <div className="msg bot">{err}</div> : null}

                  {loading ? (
                    <div className="msg bot">Loading conversation…</div>
                  ) : messages.length === 0 ? (
                    <div className="msg bot">
                      Hello. How can we help you today?
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={`msg ${m.sender === "user" ? "me" : "bot"}`}
                      >
                        {m.text}
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 border-t border-white/10 flex gap-2">
                  <input
                    className="input flex-1"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onEnter}
                    placeholder={
                      session?.mode === "human"
                        ? "Reply to support…"
                        : "Ask for help…"
                    }
                  />
                  <button
                    className="btn btnPrimary"
                    onClick={send}
                    disabled={sending}
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </div>
              </>
            )
          ) : (
            <div ref={bodyRef} className="p-4">
              <div className="msg bot">Loading support…</div>
            </div>
          )}
        </div>
      )}

      <div className="fixed bottom-24 right-4 z-[110]">
        <button className="btn btnPrimary" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide Help" : "Help"}
        </button>
      </div>
    </>
  );
}
