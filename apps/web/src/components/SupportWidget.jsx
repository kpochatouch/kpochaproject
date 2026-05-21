//apps/web/src/components/SupportWidget.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  connectSocket,
  registerSocketHandler,
  supportGetSession,
  supportGetMessages,
  supportSendMessage,
  supportRestartSession,
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
        title: "KPOCHA TOUCH Support!",
        subtitle: "A support agent is replying here",
      };
    }
    return {
      title: "KPOCHA TOUCH Support!",
      subtitle: "Your message has been sent to human support",
    };
  }

  return {
    title: "KPOCHA TOUCH Support!",
    subtitle: "How can I assist you today?",
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
  const [restarting, setRestarting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [err, setErr] = useState("");

  const bodyRef = useRef(null);
  const menuRef = useRef(null);
  const bootstrappedRef = useRef(false);

  const userUidRef = useRef("");
  const bootstrapRunRef = useRef(0);

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
    const activeUid = String(user?.uid || "");
    if (!activeUid || bootstrappedRef.current) return;

    const runId = Date.now();
    bootstrapRunRef.current = runId;

    setLoading(true);
    setErr("");

    try {
      const sessionRes = await supportGetSession();
      const messagesRes = await supportGetMessages();

      // ignore stale bootstrap result after auth/user switch
      if (bootstrapRunRef.current !== runId) return;
      if (String(userUidRef.current || "") !== activeUid) return;

      const nextSession = sessionRes.session || messagesRes.session || null;
      const nextMessages = messagesRes.messages || [];

      // never render a session that does not belong to the current signed-in user
      if (
        nextSession &&
        nextSession.userUid &&
        String(nextSession.userUid) !== activeUid
      ) {
        setSession(null);
        setMessages([]);
        setErr("Failed to load support.");
        bootstrappedRef.current = false;
        return;
      }

      setSession(nextSession);
      setMessages(nextMessages);
      bootstrappedRef.current = true;
      scrollToBottom();
    } catch (e) {
      if (bootstrapRunRef.current !== runId) return;
      setErr(e?.message || "Failed to load support.");
    } finally {
      if (bootstrapRunRef.current === runId) {
        setLoading(false);
      }
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
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!open || authLoading || !user?.uid) return;
    bootstrap();
  }, [open, authLoading, user?.uid]);

  useEffect(() => {
    if (!open || !user) return;

    connectSocket();

    const offMessage = registerSocketHandler(
      "support:message",
      ({ session: nextSession, message } = {}) => {
        const activeUid = String(userUidRef.current || "");

        if (
          nextSession &&
          nextSession.userUid &&
          activeUid &&
          String(nextSession.userUid) !== activeUid
        ) {
          return;
        }

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
        const activeUid = String(userUidRef.current || "");

        if (
          nextSession &&
          nextSession.userUid &&
          activeUid &&
          String(nextSession.userUid) !== activeUid
        ) {
          return;
        }

        if (nextSession) setSession(nextSession);
      },
    );

    return () => {
      offMessage();
      offSession();
    };
  }, [open, user?.uid]);

  useEffect(() => {
    if (!open) return;
    scrollToBottom();
  }, [messages, open]);

  useEffect(() => {
    const nextUid = String(user?.uid || "");
    const prevUid = String(userUidRef.current || "");

    if (prevUid === nextUid) return;

    userUidRef.current = nextUid;
    bootstrapRunRef.current = 0;
    bootstrappedRef.current = false;

    setSession(null);
    setMessages([]);
    setText("");
    setSending(false);
    setLoading(false);
    setErr("");
  }, [user?.uid]);

  async function restartChat() {
    if (restarting || !user) return;

    setRestarting(true);
    setErr("");

    try {
      const res = await supportRestartSession();
      if (res.session) {
        setSession(res.session);
        setMessages([]);
        setText("");
      }
    } catch (e) {
      setErr(e?.message || "Failed to start a new chat.");
    } finally {
      setRestarting(false);
    }
  }

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
        <div className="kpo-support-shell">
          <div className="kpo-support-card">
            <div className="kpo-support-topbar">
              <div className="kpo-support-brand">
                <div className="kpo-support-brand-badge">
                  <img
                    src="/icons/icon-512.png"
                    alt="Kpocha Touch"
                    className="kpo-support-brand-logo"
                  />
                </div>
                <div className="kpo-support-brand-copy">
                  <div className="kpo-support-brand-title">{header.title}</div>
                  <div className="kpo-support-brand-subtitle">
                    {header.subtitle}
                  </div>
                </div>
              </div>

              <div className="kpo-support-topbar-actions">
                <div ref={menuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="kpo-support-icon-btn"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Chat menu"
                    title="Chat options"
                  >
                    •••
                  </button>

                  {menuOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        background: "#0b0f15",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "8px",
                        boxShadow: "0 12px 24px rgba(0,0,0,0.25)",
                        zIndex: 100,
                        minWidth: "160px",
                      }}
                    >
                      {session?.mode === "human" && (
                        <button
                          type="button"
                          onClick={() => {
                            restartChat();
                            setMenuOpen(false);
                          }}
                          disabled={restarting}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: "10px 14px",
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            cursor: restarting ? "not-allowed" : "pointer",
                            fontSize: "14px",
                          }}
                        >
                          {restarting ? "Starting new chat…" : "Start new chat"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMessages([]);
                          setText("");
                          setMenuOpen(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "10px 14px",
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        Clear chat
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="kpo-support-icon-btn"
                  onClick={() => setOpen(false)}
                  aria-label="Close support"
                >
                  ✕
                </button>
              </div>
            </div>

            {!authLoading ? (
              !user ? (
                <div ref={bodyRef} className="kpo-support-body">
                  <div className="kpo-support-pill">
                    Support chat is available for signed-in users.
                  </div>
                  <div className="kpo-support-pill">
                    Please close the chat and sign in to continue.
                  </div>

                  <div className="kpo-support-auth-row">
                    <Link className="kpo-support-auth-btn" to="/login">
                      Login
                    </Link>
                    <Link
                      className="kpo-support-auth-btn kpo-support-auth-btn-primary"
                      to="/client/register"
                    >
                      Sign Up
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div ref={bodyRef} className="kpo-support-body">
                    {err ? (
                      <div className="kpo-support-msg kpo-support-msg-bot">
                        {err}
                      </div>
                    ) : null}

                    {loading ? (
                      <div className="kpo-support-msg kpo-support-msg-bot">
                        Loading conversation…
                      </div>
                    ) : messages.length === 0 ? (
                      <>
                        <div className="kpo-support-pill">
                          Welcome to KPOCHA TOUCH Support!
                        </div>
                        <div className="kpo-support-pill">
                          How can I assist you today?
                        </div>
                      </>
                    ) : (
                      <>
                        {session?.mode === "human" &&
                        !messages.some((m) => m.sender === "agent") ? (
                          <div className="kpo-support-pill">
                            Your message has been sent to human support. Replies
                            will appear here. Use the menu icon to start a new
                            chat.
                          </div>
                        ) : null}

                        {messages.map((m) => (
                          <div
                            key={m.id}
                            className={`kpo-support-msg ${
                              m.sender === "user"
                                ? "kpo-support-msg-user"
                                : "kpo-support-msg-bot"
                            }`}
                          >
                            {m.text}
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  <div className="kpo-support-footer">
                    <div className="kpo-support-contact-row">
                      <span>Need a longer message?</span>
                      <Link
                        to="/contact"
                        className="kpo-support-contact-link"
                        onClick={() => setOpen(false)}
                      >
                        Open contact form
                      </Link>
                    </div>

                    <div className="kpo-support-composer">
                      <input
                        className="kpo-support-input"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={onEnter}
                        placeholder={
                          session?.mode === "human"
                            ? "Reply to support..."
                            : "Message..."
                        }
                      />

                      <button
                        type="button"
                        className="kpo-support-send"
                        onClick={send}
                        disabled={sending}
                        aria-label="Send support message"
                      >
                        {sending ? "…" : "↑"}
                      </button>
                    </div>
                  </div>
                </>
              )
            ) : (
              <div ref={bodyRef} className="kpo-support-body">
                <div className="kpo-support-msg kpo-support-msg-bot">
                  Loading support…
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="hidden md:block kpo-support-bubble-wrap">
        <button
          type="button"
          className="kpo-support-bubble"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide support" : "Open support"}
        >
          <span className="kpo-support-bubble-icon">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="kpo-support-bubble-svg"
            >
              <path
                d="M12 3C6.477 3 2 6.94 2 11.8c0 2.274.987 4.346 2.606 5.91L4 22l4.69-2.184c1.015.25 2.096.384 3.31.384 5.523 0 10-3.94 10-8.8S17.523 3 12 3Zm-4 7.8h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0-3h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 6h5a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z"
                fill="currentColor"
              />
            </svg>
          </span>
        </button>
      </div>
    </>
  );
}
