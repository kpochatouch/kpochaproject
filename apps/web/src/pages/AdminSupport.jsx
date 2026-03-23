//apps/web/src/pages/AdminSupport.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminSupportGetMessages,
  adminSupportGetSessions,
  adminSupportSendMessage,
  adminSupportUpdateSession,
  connectSocket,
  registerSocketHandler,
} from "../lib/api";
import { useMe } from "../context/MeContext.jsx";

function sortSessions(rows) {
  return [...rows].sort(
    (a, b) => Number(b.lastMessageAt || 0) - Number(a.lastMessageAt || 0),
  );
}

function mergeMessageList(prev, next) {
  const map = new Map();

  [...prev, ...next].forEach((m) => {
    if (!m?.id) return;
    map.set(String(m.id), m);
  });

  return [...map.values()].sort(
    (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
  );
}

function formatDateTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function senderLabel(sender) {
  if (sender === "user") return "User";
  if (sender === "assistant") return "Assistant";
  if (sender === "agent") return "Admin";
  return sender || "Unknown";
}

export default function AdminSupport() {
  const { isAdmin, loading } = useMe();

  const [chatSessions, setChatSessions] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const chatBodyRef = useRef(null);
  const selectedSessionIdRef = useRef("");

  const selectedSessionFromList = useMemo(
    () =>
      chatSessions.find((s) => String(s.id) === String(selectedSessionId)) ||
      selectedSession,
    [chatSessions, selectedSession, selectedSessionId],
  );

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      if (chatBodyRef.current) {
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      }
    });
  }

  async function loadChatSessions() {
    setChatLoading(true);
    setChatErr("");

    try {
      const res = await adminSupportGetSessions();
      const rows = sortSessions(res.sessions || []);
      setChatSessions(rows);

      if (!selectedSessionIdRef.current && rows.length > 0) {
        setSelectedSessionId(String(rows[0].id));
      }
    } catch (e) {
      setChatErr(e?.message || "Failed to load support sessions.");
    } finally {
      setChatLoading(false);
    }
  }

  async function loadSelectedSessionMessages(sessionId) {
    if (!sessionId) return;

    setChatErr("");

    try {
      const res = await adminSupportGetMessages(sessionId);
      setSelectedSession(res.session || null);
      setSessionMessages(res.messages || []);

      setChatSessions((prev) =>
        sortSessions(
          prev.map((s) =>
            String(s.id) === String(sessionId)
              ? { ...s, ...(res.session || {}), unreadAdminCount: 0 }
              : s,
          ),
        ),
      );

      scrollChatToBottom();
    } catch (e) {
      setChatErr(e?.message || "Failed to load support messages.");
    }
  }

  async function sendAdminReply() {
    const clean = replyText.trim();
    if (!clean || !selectedSessionId || sendingReply) return;

    setSendingReply(true);
    setChatErr("");

    try {
      const res = await adminSupportSendMessage(selectedSessionId, clean);
      setReplyText("");

      if (res.session) {
        setSelectedSession(res.session);
        setChatSessions((prev) => {
          const exists = prev.some(
            (s) => String(s.id) === String(res.session.id),
          );

          const next = exists
            ? prev.map((s) =>
                String(s.id) === String(res.session.id) ? res.session : s,
              )
            : [res.session, ...prev];

          return sortSessions(next);
        });
      }

      if (res.message) {
        setSessionMessages((prev) => mergeMessageList(prev, [res.message]));
      }

      scrollChatToBottom();
    } catch (e) {
      setChatErr(e?.message || "Failed to send support reply.");
    } finally {
      setSendingReply(false);
    }
  }

  async function closeSelectedChat() {
    if (!selectedSessionId) return;
    try {
      const res = await adminSupportUpdateSession(selectedSessionId, {
        status: "closed",
      });
      if (res.session) {
        setSelectedSession(res.session);
        setChatSessions((prev) =>
          sortSessions(
            prev.map((s) =>
              String(s.id) === String(res.session.id) ? res.session : s,
            ),
          ),
        );
      }
    } catch (e) {
      setChatErr(e?.message || "Failed to close support session.");
    }
  }

  async function reopenSelectedChat() {
    if (!selectedSessionId) return;
    try {
      const res = await adminSupportUpdateSession(selectedSessionId, {
        status: "open",
      });
      if (res.session) {
        setSelectedSession(res.session);
        setChatSessions((prev) =>
          sortSessions(
            prev.map((s) =>
              String(s.id) === String(res.session.id) ? res.session : s,
            ),
          ),
        );
      }
    } catch (e) {
      setChatErr(e?.message || "Failed to reopen support session.");
    }
  }

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (!loading && isAdmin) {
      loadChatSessions();
    }
  }, [loading, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedSessionId) return;
    loadSelectedSessionMessages(selectedSessionId);
  }, [isAdmin, selectedSessionId]);

  useEffect(() => {
    if (!isAdmin) return;

    const s = connectSocket();
    try {
      s?.emit?.("join:admin-support", {}, () => {});
    } catch {}

    const offUpdated = registerSocketHandler(
      "admin-support:session-updated",
      ({ session } = {}) => {
        if (!session) return;

        setChatSessions((prev) => {
          const exists = prev.some((s) => String(s.id) === String(session.id));
          const next = exists
            ? prev.map((s) =>
                String(s.id) === String(session.id) ? session : s,
              )
            : [session, ...prev];
          return sortSessions(next);
        });

        if (String(selectedSessionIdRef.current) === String(session.id)) {
          setSelectedSession(session);
        }
      },
    );

    const offEscalated = registerSocketHandler(
      "admin-support:escalated",
      ({ session, messages } = {}) => {
        if (session) {
          setChatSessions((prev) => {
            const exists = prev.some(
              (s) => String(s.id) === String(session.id),
            );
            const next = exists
              ? prev.map((s) =>
                  String(s.id) === String(session.id) ? session : s,
                )
              : [session, ...prev];
            return sortSessions(next);
          });

          if (!selectedSessionIdRef.current) {
            setSelectedSessionId(String(session.id));
          }
        }

        if (
          session &&
          String(selectedSessionIdRef.current) === String(session.id) &&
          Array.isArray(messages)
        ) {
          setSelectedSession(session);
          setSessionMessages((prev) => mergeMessageList(prev, messages));
          scrollChatToBottom();
        }
      },
    );

    const offMessage = registerSocketHandler(
      "admin-support:message",
      ({ session, message } = {}) => {
        if (session) {
          setChatSessions((prev) => {
            const exists = prev.some(
              (s) => String(s.id) === String(session.id),
            );
            const next = exists
              ? prev.map((s) =>
                  String(s.id) === String(session.id) ? session : s,
                )
              : [session, ...prev];
            return sortSessions(next);
          });
        }

        if (
          session &&
          message &&
          String(selectedSessionIdRef.current) === String(session.id)
        ) {
          setSelectedSession(session);
          setSessionMessages((prev) => mergeMessageList(prev, [message]));
          scrollChatToBottom();
        }
      },
    );

    return () => {
      offUpdated();
      offEscalated();
      offMessage();
    };
  }, [isAdmin]);

  function onReplyEnter(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminReply();
    }
  }

  if (loading) {
    return <div className="container py-6">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="container py-6">
        <div className="card">
          <h2>Admin Support</h2>
          <div className="contactNotice contactNoticeError">
            Forbidden: admin only.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container adminPage">
      <div className="card adminCard">
        <div className="adminSectionHead">
          <div>
            <h2>Admin — Support Inbox</h2>
            <small>Escalated support sessions needing human help.</small>
          </div>

          <button
            className="btn btnOutline"
            type="button"
            onClick={loadChatSessions}
            disabled={chatLoading}
          >
            {chatLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {chatErr ? (
          <div className="contactNotice contactNoticeError">{chatErr}</div>
        ) : null}

        <div className="adminChatLayout">
          <div className="adminChatSidebar">
            <div className="adminChatSidebarHead">
              <strong>Escalated Sessions</strong>
            </div>

            <div className="adminChatSidebarBody">
              {chatLoading ? (
                <div className="muted adminChatMutedBox">
                  Loading support queue...
                </div>
              ) : chatSessions.length === 0 ? (
                <div className="muted adminChatMutedBox">
                  No escalated sessions yet.
                </div>
              ) : (
                chatSessions.map((session) => {
                  const active =
                    String(session.id) === String(selectedSessionId);

                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(String(session.id))}
                      className={`adminChatSessionItem${
                        active ? " isActive" : ""
                      }`}
                    >
                      <div className="adminChatSessionTop">
                        <div className="adminChatSessionMain">
                          <div className="adminChatSessionTitle">
                            {session.userUid}
                          </div>

                          <div className="muted adminChatSessionPreview">
                            {session.lastMessageText || "No messages yet."}
                          </div>
                        </div>

                        <div className="adminChatSessionMeta">
                          <div className="badge">
                            {formatDateTime(session.lastMessageAt)}
                          </div>

                          {session.escalated ? (
                            <div className="badge">Escalated</div>
                          ) : null}

                          {Number(session.unreadAdminCount || 0) > 0 ? (
                            <div className="badge">
                              {session.unreadAdminCount} unread
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="adminChatMain">
            <div className="adminChatMainHead">
              <div>
                <strong>
                  {selectedSessionFromList
                    ? selectedSessionFromList.userUid
                    : "Select a session"}
                </strong>
                <div className="muted adminChatMainSub">
                  {selectedSessionFromList
                    ? `Mode: ${selectedSessionFromList.mode || "-"} • Status: ${
                        selectedSessionFromList.status || "-"
                      }`
                    : "Choose an escalated session from the left."}
                </div>
              </div>

              {selectedSessionFromList ? (
                <div className="adminChatHeadActions">
                  {selectedSessionFromList.status === "closed" ? (
                    <button
                      className="btn btnOutline"
                      type="button"
                      onClick={reopenSelectedChat}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      className="btn btnOutline"
                      type="button"
                      onClick={closeSelectedChat}
                    >
                      Close
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            <div ref={chatBodyRef} className="adminChatMessages">
              {!selectedSessionFromList ? (
                <div className="muted">No session selected.</div>
              ) : sessionMessages.length === 0 ? (
                <div className="muted">No messages yet.</div>
              ) : (
                sessionMessages.map((m) => {
                  const isAdmin = m.sender === "agent";
                  const isUser = m.sender === "user";

                  return (
                    <div
                      key={m.id}
                      className={`adminChatMessageRow${
                        isAdmin ? " isAdmin" : ""
                      }`}
                    >
                      <div
                        className={
                          isUser ? "msg me" : isAdmin ? "msg me" : "msg bot"
                        }
                      >
                        <div className="adminChatMessageMeta">
                          {senderLabel(m.sender)} •{" "}
                          {formatDateTime(m.createdAt)}
                        </div>
                        <div>{m.text}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="adminChatComposer">
              <div className="adminChatComposerGrid">
                <textarea
                  className="input adminChatTextarea"
                  rows={3}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={onReplyEnter}
                  placeholder={
                    selectedSessionFromList
                      ? "Reply to this user..."
                      : "Select a session first..."
                  }
                  disabled={!selectedSessionFromList || sendingReply}
                />

                <button
                  className="btn btnPrimary"
                  type="button"
                  onClick={sendAdminReply}
                  disabled={
                    !selectedSessionFromList ||
                    !replyText.trim() ||
                    sendingReply
                  }
                >
                  {sendingReply ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
