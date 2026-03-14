//apps/web/src/pages/MyAdverts.jsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function MyAdverts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await api.get("/api/adverts/me");
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setMsg("Could not load adverts.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function submitAdvert(id) {
    try {
      await api.patch(`/api/adverts/${id}/submit`);
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.error || "Submit failed.");
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold">My Adverts</h1>
        <Link
          to="/adverts/new"
          className="rounded-lg bg-white text-black px-4 py-2"
        >
          Create advert
        </Link>
      </div>

      {msg ? <div className="mb-4 text-sm text-red-400">{msg}</div> : null}

      {loading ? (
        <div>Loading…</div>
      ) : !items.length ? (
        <div className="rounded-xl border border-zinc-800 p-6 text-zinc-400">
          No adverts yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((ad) => (
            <div key={ad._id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-semibold">
                    {ad.title || "Untitled advert"}
                  </div>
                  <div className="text-sm text-zinc-400 mt-1">
                    {ad.text || "—"}
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">
                    Status: {ad.status} • Placements:{" "}
                    {(ad.placements || []).join(", ")}
                  </div>
                  {ad.rejectionReason ? (
                    <div className="text-xs text-red-400 mt-2">
                      Rejection reason: {ad.rejectionReason}
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {["draft", "rejected", "submitted"].includes(ad.status) ? (
                    <Link
                      to={`/adverts/${ad._id}/edit`}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
                    >
                      Edit
                    </Link>
                  ) : null}

                  {["draft", "rejected"].includes(ad.status) ? (
                    <button
                      onClick={() => submitAdvert(ad._id)}
                      className="rounded-lg bg-white text-black px-3 py-2 text-sm"
                    >
                      Submit
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
