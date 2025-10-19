// apps/web/src/pages/AdminDecline.jsx
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

export default function AdminDecline() {
  const { id } = useParams();
  const nav = useNavigate();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      await api.post(`/api/pros/decline/${encodeURIComponent(id)}`, { reason });
      nav("/admin");
    } catch (e) {
      const err = e?.response?.data?.error || e.message || "Decline failed.";
      setMsg(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-4">Decline Application</h2>
      {msg && <div className="text-sm text-red-400 mb-3">{msg}</div>}

      <form onSubmit={submit} className="space-y-3">
        <textarea
          className="w-full h-40 bg-black border border-zinc-800 rounded-lg px-3 py-2"
          placeholder="Give a clear reason visible to the applicant…"
          value={reason}
          onChange={(e)=>setReason(e.target.value)}
        />
        <div className="flex gap-3">
          <button
            disabled={busy || !reason.trim()}
            className="bg-red-500 text-white px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {busy ? "Declining…" : "Submit Decline"}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-zinc-700"
            onClick={()=>nav("/admin")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
