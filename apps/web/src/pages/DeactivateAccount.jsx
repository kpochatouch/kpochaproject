// apps/web/src/pages/DeactivateAccount.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function DeactivateAccount() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);

  const [reason, setReason] = useState("");
  const [req, setReq] = useState(null); // latest request
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const [{ data: meData }, { data: status }] = await Promise.all([
        api.get("/api/me"),
        api.get("/api/account/deactivation/me").catch(() => ({ data: null })),
      ]);
      setMe(meData || null);
      setReq(status || null);
    } catch {
      setErr("Unable to load your account. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit() {
    try {
      setErr("");
      setOk("");
      const { data } = await api.post("/api/account/deactivate-request", {
        reason,
      });
      setReq(data?.request || null);
      setOk("Your deactivation request has been submitted.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to submit request.");
    }
  }

  const pending = req?.status === "pending";
  const approved = req?.status === "approved";
  const rejected = req?.status === "rejected";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">Deactivate Account</h1>
        <Link to="/settings" className="text-sm underline">
          ← Back to Settings
        </Link>
      </div>

      {loading && <div>Loading…</div>}
      {!loading && (
        <>
          {err && (
            <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
              {err}
            </div>
          )}
          {ok && (
            <div className="mb-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">
              {ok}
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 p-4 space-y-4 bg-black/40">
            <p className="text-sm text-zinc-300">
              Deactivating your account will disable sign-in and hide your
              profile. No data will be deleted. An admin will review your
              request and either approve or reject it. You can cancel by
              contacting support before approval.
            </p>

            <div className="grid gap-2">
              <label className="text-sm text-zinc-300">Reason (optional)</label>
              <textarea
                rows={4}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
                placeholder="Tell us why you want to leave…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending || approved}
              />
            </div>

            <div className="flex items-center justify-between">
              <StatusBadge status={req?.status} createdAt={req?.createdAt} />
              <div className="flex gap-2">
                <Link to="/settings" className="px-3 py-2 border rounded">
                  Cancel
                </Link>
                <button
                  onClick={submit}
                  disabled={pending || approved}
                  className="px-4 py-2 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50"
                >
                  {pending
                    ? "Request Pending"
                    : approved
                      ? "Approved"
                      : "Submit Request"}
                </button>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="text-xs text-zinc-500 mt-4">
            • If approved, your account will be disabled (soft deactivated).
            <br />• If rejected, you’ll remain active and may re-apply later.
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, createdAt }) {
  if (!status)
    return (
      <span className="text-zinc-400 text-sm">No request submitted yet.</span>
    );
  const map = {
    pending: {
      label: "Pending review",
      cls: "bg-yellow-900/40 text-yellow-200 border-yellow-800",
    },
    approved: {
      label: "Approved",
      cls: "bg-green-900/30 text-green-100 border-green-800",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-red-900/30 text-red-100 border-red-800",
    },
  };
  const m = map[status] || map.pending;
  return (
    <span className={`text-sm px-2 py-1 rounded border ${m.cls}`}>
      {m.label}
      {createdAt ? ` — ${new Date(createdAt).toLocaleString()}` : ""}
    </span>
  );
}
