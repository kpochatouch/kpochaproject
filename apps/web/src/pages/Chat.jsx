// apps/web/src/pages/Chat.jsx
import ChatPane from "../components/ChatPane";

export default function Chat() {
  // dummy values — later we’ll pass a real socket + room
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Chat (coming soon)</h1>
      <p className="text-zinc-400 text-sm mb-4">
        We will plug this into your existing Socket.IO relay
        (<code className="bg-zinc-900 px-1 rounded">apps/api/sockets/index.js</code>)
        so it can do 1:1 and booking chats.
      </p>
      <div className="rounded-lg border border-zinc-800">
        <ChatPane socket={null} room={null} me={"me"} />
      </div>
    </div>
  );
}
