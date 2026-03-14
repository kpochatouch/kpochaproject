//apps/web/src/pages/AdminAdvertsReview.jsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export default function AdminAdvertsReview() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("submitted");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await api.get("/api/adverts/admin/list", {
        params: status ? { status } : {},
      });
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setMsg("Could not load admin adverts.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  async function approve(id) {
    try {
      await api.patch(`/api/adverts/${id}/approve`);
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Approve failed.");
    }
  }

  async function reject(id) {
    const reason = window.prompt("Enter rejection reason");
    if (!reason?.trim()) return;

    try {
      await api.patch(`/api/adverts/${id}/reject`, { reason: reason.trim() });
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Reject failed.");
    }
  }

  async function setAdvertStatus(id, nextStatus) {
    try {
      await api.patch(`/api/adverts/${id}/status`, { status: nextStatus });
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Status update failed.");
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-semibold">Advert Review</h1>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-black px-3 py-2"
        >
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {msg ? <div className="mb-4 text-sm text-red-400">{msg}</div> : null}

      {loading ? (
        <div>Loading…</div>
      ) : !items.length ? (
        <div className="rounded-xl border border-zinc-800 p-6 text-zinc-400">
          No adverts found.
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((ad) => (
            <div key={ad._id} className="rounded-xl border border-zinc-800 p-4">
              <div className="grid lg:grid-cols-[220px_1fr] gap-4">
                <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 min-h-[180px]">
                  {ad.media?.[0]?.type === "video" ? (
                    <video
                      src={ad.media?.[0]?.url}
                      controls
                      className="w-full h-full object-cover"
                    />
                  ) : ad.media?.[0]?.url ? (
                    <img
                      src={ad.media?.[0]?.url}
                      alt={ad.title || "Advert"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                      No media
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-semibold">
                    {ad.title || "Untitled advert"}
                  </div>
                  <div className="text-sm text-zinc-400 mt-1">
                    {ad.text || "—"}
                  </div>

                  <div className="text-xs text-zinc-500 mt-3 space-y-1">
                    <div>Status: {ad.status}</div>
                    <div>Goal: {ad.goal}</div>
                    <div>Action: {ad.actionType}</div>
                    <div>Action Value: {ad.actionValue}</div>
                    <div>Placements: {(ad.placements || []).join(", ")}</div>
                    <div>
                      Dates: {new Date(ad.startsAt).toLocaleString()} →{" "}
                      {new Date(ad.endsAt).toLocaleString()}
                    </div>
                    <div>
                      Metrics: {ad.impressionsCount || 0} impressions •{" "}
                      {ad.clicksCount || 0} clicks
                    </div>
                    {ad.rejectionReason ? (
                      <div className="text-red-400">
                        Rejection reason: {ad.rejectionReason}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex gap-2 flex-wrap mt-4">
                    {ad.status === "submitted" ? (
                      <>
                        <button
                          onClick={() => approve(ad._id)}
                          className="rounded-lg bg-[#d4af37] text-black px-3 py-2 text-sm font-semibold"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reject(ad._id)}
                          className="rounded-lg border border-red-500 text-red-400 px-3 py-2 text-sm"
                        >
                          Reject
                        </button>
                      </>
                    ) : null}

                    {["approved", "paused", "active"].includes(ad.status) ? (
                      <>
                        <button
                          onClick={() => setAdvertStatus(ad._id, "active")}
                          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
                        >
                          Activate
                        </button>
                        <button
                          onClick={() => setAdvertStatus(ad._id, "paused")}
                          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
                        >
                          Pause
                        </button>
                        <button
                          onClick={() => setAdvertStatus(ad._id, "ended")}
                          className="rounded-lg border border-red-500 text-red-400 px-3 py-2 text-sm"
                        >
                          End
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
