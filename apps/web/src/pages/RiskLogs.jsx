// apps/web/src/pages/RiskLogs.jsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function RiskLogs() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(null);
  const [loadingOne, setLoadingOne] = useState(false);
  const [searchId, setSearchId] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [scoreMin, setScoreMin] = useState("");

  // 1) try to fetch list — this will work once backend exposes GET /api/risk
  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        // try the obvious endpoint first
        const { data } = await api
          .get("/api/risk", {
            params: { limit: 200 },
          })
          .catch(() => ({ data: null }));

        if (!on) return;

        if (Array.isArray(data)) {
          setItems(data);
        } else if (Array.isArray(data?.items)) {
          setItems(data.items);
        } else {
          // backend not ready yet
          setItems([]);
          setErr(
            "Risk endpoint is not exposed for list yet. Add GET /api/risk on the API.",
          );
        }
      } catch (e) {
        if (!on) return;
        setErr("Could not load risk events.");
        setItems([]);
      } finally {
        if (on) setLoading(false);
      }
    })();

    return () => {
      on = false;
    };
  }, []);

  // 2) fetch single by id – this one exists in your api: GET /api/risk/liveness/:id
  async function fetchOne(id) {
    if (!id) return;
    setLoadingOne(true);
    setErr("");
    try {
      const { data } = await api.get(`/api/risk/liveness/${id}`);
      setSelected(data);
    } catch (e) {
      setErr("Could not load that risk item (check the id).");
      setSelected(null);
    } finally {
      setLoadingOne(false);
    }
  }

  // derived filtered list
  const filtered = items
    .filter((it) => {
      if (!reasonFilter) return true;
      return (it.reason || "").toLowerCase() === reasonFilter.toLowerCase();
    })
    .filter((it) => {
      if (!scoreMin) return true;
      const s = typeof it.score === "number" ? it.score : 0;
      return s >= Number(scoreMin);
    });

  const hasList = items && items.length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Risk Logs</h1>
          <p className="text-zinc-500 text-sm">
            Liveness / verification events stored in{" "}
            <code className="bg-zinc-900 px-1 rounded">risk_events</code>. This
            UI will auto-fill once the API exposes a list endpoint.
          </p>
        </div>

        {/* load single by id */}
        <div className="flex items-center gap-2">
          <input
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            placeholder="risk event id…"
            className="bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-sm w-48"
          />
          <button
            onClick={() => fetchOne(searchId.trim())}
            className="bg-gold text-black rounded-lg px-3 py-1.5 text-sm font-semibold"
            disabled={!searchId.trim()}
          >
            {loadingOne ? "Loading…" : "Open"}
          </button>
        </div>
      </div>

      {/* filters for the list */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="bg-black border border-zinc-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All reasons</option>
          <option value="onboarding">onboarding</option>
          <option value="payout">payout</option>
          <option value="suspicious_login">suspicious_login</option>
          <option value="unspecified">unspecified</option>
        </select>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={scoreMin}
          onChange={(e) => setScoreMin(e.target.value)}
          placeholder="min score e.g. 0.7"
          className="bg-black border border-zinc-800 rounded-lg px-3 py-1.5 text-sm w-40"
        />
        <button
          onClick={() => {
            setReasonFilter("");
            setScoreMin("");
          }}
          className="text-sm text-zinc-300 underline underline-offset-4"
        >
          Clear filters
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded border border-amber-800 bg-amber-950/30 text-amber-100 px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* main layout: list + detail */}
      <div className="grid lg:grid-cols-[1.6fr,1fr] gap-6">
        {/* LIST */}
        <div className="rounded-xl border border-zinc-800 bg-black/30 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-zinc-300">Recent risk events</span>
            {loading && <span className="text-xs text-zinc-500">Loading…</span>}
          </div>

          {!loading && !hasList ? (
            <div className="p-4 text-sm text-zinc-500">
              No risk events to display yet.
              <br />
              Make sure the API exposes{" "}
              <code className="bg-zinc-900 px-1 rounded">
                GET /api/risk
              </code>{" "}
              that returns an array.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((item) => (
                <li
                  key={item._id || item.id}
                  className="px-4 py-3 hover:bg-zinc-900/40 cursor-pointer"
                  onClick={() => setSelected(item)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {item.reason || "liveness"}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {item.email || item.uid || "unknown"} •{" "}
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString()
                          : "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          typeof item.score === "number" && item.score < 0.6
                            ? "bg-red-900/50 text-red-100"
                            : "bg-emerald-900/40 text-emerald-100"
                        }`}
                      >
                        score{" "}
                        {typeof item.score === "number"
                          ? item.score.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                  </div>
                </li>
              ))}

              {loading && (
                <li className="p-4 text-sm text-zinc-400">Loading…</li>
              )}
            </ul>
          )}
        </div>

        {/* DETAIL */}
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <h2 className="text-sm font-semibold mb-3 text-white">
            Event detail
          </h2>

          {!selected ? (
            <p className="text-sm text-zinc-500">
              Select an item on the left or paste an id and click <b>Open</b>.
              This uses the existing API route{" "}
              <code className="bg-zinc-900 px-1 rounded">
                GET /api/risk/liveness/:id
              </code>
              .
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-zinc-500 text-xs mb-1">ID</div>
                <div className="font-mono text-xs break-all">
                  {selected._id || selected.id}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Reason</div>
                  <div>{selected.reason || "—"}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Score</div>
                  <div>
                    {typeof selected.score === "number"
                      ? selected.score.toFixed(3)
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-zinc-500 text-xs mb-1">User</div>
                  <div>{selected.email || selected.uid || "—"}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Created</div>
                  <div>
                    {selected.createdAt
                      ? new Date(selected.createdAt).toLocaleString()
                      : "—"}
                  </div>
                </div>
              </div>

              {/* media previews */}
              {(selected.selfieUrl || selected.videoUrl) && (
                <div>
                  <div className="text-zinc-500 text-xs mb-1">Media</div>
                  <div className="space-y-2">
                    {selected.selfieUrl ? (
                      <img
                        src={selected.selfieUrl}
                        alt="selfie"
                        className="w-32 h-32 object-cover rounded-lg border border-zinc-800"
                      />
                    ) : null}
                    {selected.videoUrl ? (
                      <video
                        src={selected.videoUrl}
                        controls
                        className="w-full rounded-lg border border-zinc-800"
                      />
                    ) : null}
                  </div>
                </div>
              )}

              {/* context/metrics raw */}
              <div>
                <div className="text-zinc-500 text-xs mb-1">
                  Context / Metrics
                </div>
                <pre className="bg-black/40 border border-zinc-800 rounded-lg p-2 text-xs overflow-auto max-h-40">
                  {JSON.stringify(
                    {
                      context: selected.context || {},
                      metrics: selected.metrics || {},
                      ip: selected.ip || "",
                      userAgent: selected.userAgent || "",
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
