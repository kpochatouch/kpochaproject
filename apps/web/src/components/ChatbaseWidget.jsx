// apps/web/src/components/ChatbaseWidget.jsx
import { useEffect } from "react";
import { api } from "../lib/api";

export default function ChatbaseWidget() {
  useEffect(() => {
    const CHATBOT_ID = import.meta.env.VITE_CHATBASE_ID; // 5gZgvHpeJvGhp8cWAlEvZ
    if (!CHATBOT_ID) return;

    // 1) bootstrap chatbase queue (official pattern)
    if (!window.chatbase || window.chatbase("getState") !== "initialized") {
      const q = (...args) => {
        if (!window.chatbase.q) window.chatbase.q = [];
        window.chatbase.q.push(args);
      };
      window.chatbase = new Proxy(q, {
        get(target, prop) {
          if (prop === "q") return target.q;
          return (...args) => target(prop, ...args);
        },
      });
    }

    // 2) load the widget script
    const onLoad = () => {
      const s = document.createElement("script");
      s.src = "https://www.chatbase.co/embed.min.js";
      s.id = CHATBOT_ID;
      s.domain = "www.chatbase.co";
      document.body.appendChild(s);
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);

    // 3) try to fetch a signed user (requires auth token via api helper)
    (async () => {
      try {
        // If user is logged-in, api will include Authorization header
        const { data } = await api.get("/api/chatbase/sign");
        if (data?.userId && data?.userHash) {
          window.chatbase("setUser", {
            userId: data.userId,
            userHash: data.userHash, // HMAC from backend
          });
        }
      } catch {
        // not logged-in or couldn’t sign; widget still works anonymously
      }
    })();

    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
