import { useEffect, useRef, useState } from "react";

export default function ChatPane({ socket, room, me }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    if (!socket) return;
    function onMsg(m) { setMsgs((x) => [...x, m]); }
    socket.on("chat:message", onMsg);
    return () => socket.off("chat:message", onMsg);
  }, [socket]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function send() {
    const body = text.trim();
    if (!body) return;
    const payload = { room, from: me, body, ts: Date.now() };
    socket.emit("chat:message", payload);
    setMsgs((x) => [...x, payload]);
    setText("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-2 p-3 border border-zinc-800 rounded-xl">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[80%] px-3 py-2 rounded-xl ${m.from===me?"bg-zinc-800 ml-auto":"bg-zinc-900"}`}>
            <div className="text-xs text-zinc-400">{m.from===me?"You":m.from}</div>
            <div className="text-sm">{m.body}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
        />
        <button className="px-4 py-2 rounded-lg bg-gold text-black font-semibold" onClick={send}>Send</button>
      </div>
    </div>
  );
}
