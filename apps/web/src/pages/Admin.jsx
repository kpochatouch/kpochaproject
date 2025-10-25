// apps/web/src/pages/Admin.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

/** ------------------------------------------------------------------------
 * Admin Dashboard
 * - System Settings (GET /api/settings/admin, PUT /api/settings)
 * - Applications (GET /api/pros/pending, POST /api/pros/approve/:id)
 * - Deactivation Requests (GET/POST admin endpoints)
 * ------------------------------------------------------------------------ */

export default function AdminPage() {
  const [tab, setTab] = useState("settings");
  const tabs = [
    { key: "settings", label: "System Settings" },
    { key: "apps", label: "Applications" },
    { key: "deact", label: "Deactivation Requests" },
  ];
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-zinc-400 text-sm">Manage platform config, review applications, handle deactivations.</p>
        </div>
        <Link to="/" className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900">← Back</Link>
      </div>

      <div className="mb-4 flex gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg border ${tab === t.key ? "border-gold text-gold" : "border-zinc-700 hover:bg-zinc-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "settings" && <SystemSettings />}
      {tab === "apps" && <ApplicationsPanel />}
      {tab === "deact" && <DeactivationPanel />}
    </div>
  );
}

/* ===========================================================================
   System Settings
   ========================================================================== */
function SystemSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const okTimer = useRef(null);

  const [doc, setDoc] = useState(null);

  function flashOK(msg) {
    setOk(msg);
    if (okTimer.current) clearTimeout(okTimer.current);
    okTimer.current = setTimeout(() => setOk(""), 2500);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const { data } = await api.get("/api/settings/admin");
        if (!alive) return;
        setDoc(data || {});
      } catch (e) {
        if (alive) setErr(e?.response?.data?.error || "Failed to load settings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; if (okTimer.current) clearTimeout(okTimer.current); };
  }, []);

  function setPath(path, value) {
    setDoc(prev => {
      const next = { ...(prev || {}) };
      const parts = path.split(".");
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        cur[k] = cur[k] ?? {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  }

  async function save() {
    if (!doc) return;
    setSaving(true);
    setErr("");
    try {
      // Server restarts schedulers automatically after save
      const { data } = await api.put("/api/settings", doc);
      setDoc(data || doc);
      flashOK("Settings saved.");
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="mt-4">Loading settings…</div>;
  if (!doc) return <div className="mt-4 text-red-400">No settings document found.</div>;

  const commission = doc.commissionSplit || {};
  const payouts = doc.payouts || {};
  const rules = doc.bookingRules || {};
  const maintenance = doc.maintenance || {};
  const notifications = doc.notifications || {};
  const security = doc.security || {};
  const webhooks = doc.webhooks || {};

  return (
    <div className="space-y-6">
      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}

      <Card title="Brand">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="App Name" value={doc.appName || ""} onChange={v => setPath("appName", v)} />
          <Input label="Tagline" value={doc.tagline || ""} onChange={v => setPath("tagline", v)} />
        </div>
      </Card>

      <Card title="Commission Split">
        <div className="grid sm:grid-cols-2 gap-3">
          <NumberInput
            label="Platform %"
            value={commission.platform ?? 25}
            onChange={v => setPath("commissionSplit.platform", clamp0(v))}
          />
          <NumberInput
            label="Pro %"
            value={commission.pro ?? 75}
            onChange={v => setPath("commissionSplit.pro", clamp0(v))}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Tip: platform + pro should be 100. Server doesn’t enforce this — it’s your responsibility.
        </p>
      </Card>

      <Card title="Payouts">
        <div className="grid sm:grid-cols-3 gap-3">
          <NumberInput
            label="Release after (days)"
            value={payouts.releaseDays ?? 7}
            onChange={v => setPath("payouts.releaseDays", clamp0(v))}
          />
          <NumberInput
            label="Instant cashout fee %"
            value={payouts.instantCashoutFeePercent ?? 3}
            onChange={v => setPath("payouts.instantCashoutFeePercent", clamp0(v))}
          />
          <Toggle
            label="Enable auto-release"
            checked={!!payouts.enableAutoRelease}
            onChange={v => setPath("payouts.enableAutoRelease", v)}
          />
        </div>
        <Input
          label="Auto-release CRON"
          value={payouts.autoReleaseCron || ""}
          onChange={v => setPath("payouts.autoReleaseCron", v)}
          placeholder='e.g. "0 2 * * *"'
        />
        <p className="text-xs text-zinc-500 mt-2">
          Changes to CRON or toggles will restart schedulers server-side.
        </p>
      </Card>

      <Card title="Booking Rules">
        <div className="grid sm:grid-cols-3 gap-3">
          <NumberInput
            label="No-show strike limit"
            value={rules.noShowStrikeLimit ?? 2}
            onChange={v => setPath("bookingRules.noShowStrikeLimit", clamp0(v))}
          />
          <Toggle
            label="Enable no-show sweep"
            checked={!!rules.enableNoShowSweep}
            onChange={v => setPath("bookingRules.enableNoShowSweep", v)}
          />
        </div>
        <Input
          label="No-show sweep CRON"
          value={rules.noShowSweepCron || ""}
          onChange={v => setPath("bookingRules.noShowSweepCron", v)}
          placeholder='e.g. "0 3 * * *"'
        />
      </Card>

      <Card title="Maintenance Mode">
        <div className="grid sm:grid-cols-3 gap-3">
          <Toggle
            label="Enable maintenance mode"
            checked={!!maintenance.isMaintenanceMode}
            onChange={v => setPath("maintenance.isMaintenanceMode", v)}
          />
          <Input
            label="Message"
            value={maintenance.message || ""}
            onChange={v => setPath("maintenance.message", v)}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          While enabled, only admins and a few endpoints (health/settings/webhooks) are accessible.
        </p>
      </Card>

      <Card title="Notifications">
        <div className="grid sm:grid-cols-3 gap-3">
          <Toggle
            label="Email enabled"
            checked={!!notifications.emailEnabled}
            onChange={v => setPath("notifications.emailEnabled", v)}
          />
          <Toggle
            label="SMS enabled"
            checked={!!notifications.smsEnabled}
            onChange={v => setPath("notifications.smsEnabled", v)}
          />
        </div>
      </Card>

      <Card title="Security">
        <Textarea
          label="Allowed Origins (one per line)"
          value={(security.allowedOrigins || []).join("\n")}
          onChange={v => setPath("security.allowedOrigins", splitLines(v))}
          rows={5}
        />
        <p className="text-xs text-zinc-500 mt-2">
          CORS allow-list (appended to any <code>CORS_ORIGIN</code> env at boot). Vercel previews are allowed by default.
        </p>
      </Card>

      <Card title="Webhooks">
        <Input
          label="Paystack Secret (used for signature)"
          value={webhooks?.paystack?.secret || ""}
          onChange={v => setPath("webhooks.paystack.secret", v)}
          type="password"
          placeholder="****"
        />
        <p className="text-xs text-zinc-500 mt-2">
          If empty, server falls back to <code>PAYSTACK_SECRET_KEY</code> / <code>PAYSTACK_WEBHOOK_SECRET</code>.
        </p>
      </Card>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

/* ===========================================================================
   Applications (pending)
   ========================================================================== */
function ApplicationsPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [viewJson, setViewJson] = useState(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/api/pros/pending");
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to load pending applications.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function approve(id) {
    try {
      await api.post(`/api/pros/approve/${encodeURIComponent(id)}`);
      setOk("Approved & upserted Pro profile.");
      await load();
      setTimeout(() => setOk(""), 2000);
    } catch (e) {
      setErr(e?.response?.data?.error || "Approval failed.");
    }
  }

  return (
    <div className="space-y-4">
      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}

      {loading ? (
        <div>Loading applications…</div>
      ) : items.length === 0 ? (
        <div className="border border-zinc-800 rounded-lg p-4 text-zinc-400">
          No pending applications.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(app => (
            <div key={app._id} className="border border-zinc-800 rounded-lg p-4 bg-black/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {app.displayName || app.email || "Unnamed"}{" "}
                    <span className="text-xs text-zinc-500">({app.status})</span>
                  </div>
                  <div className="text-sm text-zinc-400">
                    {app.phone ? `${app.phone} • ` : ""}{(app.lga || "").toUpperCase()}
                    {app.services ? ` • ${app.services}` : ""}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Submitted: {formatWhen(app.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewJson(app)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                  >
                    View JSON
                  </button>
                  <button
                    onClick={() => approve(app._id || app.clientId)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-700 text-emerald-300 text-sm hover:bg-emerald-900/30"
                  >
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewJson && (
        <Modal title="Application JSON" onClose={() => setViewJson(null)}>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(viewJson, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}

/* ===========================================================================
   Deactivation Requests
   ========================================================================== */
function DeactivationPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.get("/api/admin/deactivation-requests");
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to load deactivation requests.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function decide(id, action) {
    setErr("");
    setOk("");
    try {
      await api.post(`/api/admin/deactivation-requests/${encodeURIComponent(id)}/decision`, {
        action, note,
      });
      setOk(`Request ${action}d.`);
      setNote("");
      await load();
      setTimeout(() => setOk(""), 2000);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to submit decision.");
    }
  }

  const pending = useMemo(() => items.filter(x => x.status === "pending"), [items]);

  return (
    <div className="space-y-4">
      {err && <Alert tone="red">{err}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}

      {loading ? (
        <div>Loading requests…</div>
      ) : items.length === 0 ? (
        <div className="border border-zinc-800 rounded-lg p-4 text-zinc-400">No requests.</div>
      ) : (
        <>
          <div className="text-sm text-zinc-400">
            Pending: {pending.length} • Total: {items.length}
          </div>
          <div className="space-y-3">
            {items.map(r => (
              <div key={r._id} className="border border-zinc-800 rounded-lg p-4 bg-black/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{r.email || r.uid}</div>
                    <div className="text-sm text-zinc-400">{r.reason || "—"}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Status: <b>{r.status}</b> • Created: {formatWhen(r.createdAt)}
                      {r.decidedAt ? ` • Decided: ${formatWhen(r.decidedAt)} by ${r.decidedBy || "admin"}` : ""}
                    </div>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="bg-black border border-zinc-800 rounded px-2 py-1 text-sm"
                        placeholder="Note (optional)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        onClick={() => decide(r._id, "reject")}
                        className="px-3 py-1.5 rounded-lg border border-amber-700 text-amber-300 text-sm hover:bg-amber-900/30"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => decide(r._id, "approve")}
                        className="px-3 py-1.5 rounded-lg border border-emerald-700 text-emerald-300 text-sm hover:bg-emerald-900/30"
                      >
                        Approve
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400">No actions</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ===========================================================================
   Small UI helpers
   ========================================================================== */
function Card({ title, children }) {
  return (
    <section className="rounded-lg border border-zinc-800 p-4">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Alert({ tone = "green", children }) {
  const toneCls = tone === "red"
    ? "border-red-800 bg-red-900/40 text-red-100"
    : "border-green-800 bg-green-900/30 text-green-100";
  return <div className={`rounded px-3 py-2 ${toneCls}`}>{children}</div>;
}
function Input({ label, value, onChange, type = "text", placeholder = "", ...props }) {
  return (
    <label className="block">
      <div className="text-sm text-zinc-300 mb-1">{label}</div>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...props}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
      />
    </label>
  );
}
function NumberInput({ label, value, onChange, ...props }) {
  return (
    <Input
      label={label}
      value={String(value ?? "")}
      onChange={(v) => onChange(Number(v) || 0)}
      type="number"
      {...props}
    />
  );
}
function Toggle({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">{label}</span>
    </label>
  );
}
function Textarea({ label, value, onChange, rows = 4, placeholder = "" }) {
  return (
    <label className="block">
      <div className="text-sm text-zinc-300 mb-1">{label}</div>
      <textarea
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
      />
    </label>
  );
}
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-[min(90vw,800px)] max-h-[85vh] overflow-auto border border-zinc-800 rounded-xl bg-zinc-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-sm px-2 py-1 border border-zinc-700 rounded">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function clamp0(n) {
  const x = Number(n) || 0;
  return x < 0 ? 0 : x;
}
function splitLines(s = "") {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function formatWhen(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
