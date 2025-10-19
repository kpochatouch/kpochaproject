import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const API =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:8080";

export default function Admin() {
  const location = useLocation();
  const navigate = useNavigate();
  const qs = new URLSearchParams(location.search);
  const initialTab = qs.get("tab") === "settings" ? "settings" : "pending";

  const [tab, setTab] = useState(initialTab);

  // ---------- Shared helpers ----------
  const token = useMemo(() => localStorage.getItem("token") || "", []);
  function authHeaders() {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  function switchTab(next) {
    setTab(next);
    const q = new URLSearchParams(location.search);
    if (next === "settings") q.set("tab", "settings");
    else q.delete("tab");
    navigate({ search: q.toString() }, { replace: true });
  }

  // ======================================================================
  // TAB 1: Pending Applications
  // ======================================================================
  const [pending, setPending] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const loadPending = async () => {
    setListError("");
    setListLoading(true);
    try {
      const res = await fetch(`${API}/api/pros/pending`, { headers: { ...authHeaders() } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setPending(Array.isArray(data) ? data : []);
    } catch (e) {
      setListError("Could not load pending applications.");
    } finally {
      setListLoading(false);
    }
  };

  const approve = async (id) => {
    setBusyId(id);
    setListError("");
    try {
      const res = await fetch(`${API}/api/pros/approve/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Approve failed");
      await loadPending(); // refresh
      alert("Approved ✅");
    } catch (e) {
      setListError(e.message || "Approve failed");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = pending.filter((p) => {
    const hay = JSON.stringify(p).toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  // ======================================================================
  // TAB 2: Admin Settings (server-driven)
  // ======================================================================
  const [settings, setSettings] = useState(null);
  const [sLoading, setSLoading] = useState(false);
  const [sSaving, setSSaving] = useState(false);
  const [sError, setSError] = useState("");
  const [sOk, setSOk] = useState("");

  // Manual release (admin tool)
  const [mrBookingId, setMrBookingId] = useState("");
  const [mrBusy, setMrBusy] = useState(false);
  const [mrOk, setMrOk] = useState("");
  const [mrError, setMrError] = useState("");
  const [mrPayload, setMrPayload] = useState(null);

  async function loadSettings() {
    setSError("");
    setSOk("");
    setSLoading(true);
    try {
      const res = await fetch(`${API}/api/settings/admin`, {
        headers: { ...authHeaders() },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load settings");
      setSettings(json);
    } catch (e) {
      setSError(e.message || "Failed to load settings");
    } finally {
      setSLoading(false);
    }
  }

  async function saveSettings() {
    setSError("");
    setSOk("");
    setSSaving(true);
    try {
      const res = await fetch(`${API}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save");
      setSettings(json);
      setSOk("Settings saved. Schedulers restarted.");
    } catch (e) {
      setSError(e.message || "Failed to save settings");
    } finally {
      setSSaving(false);
    }
  }

  async function manualReleaseNow() {
    setMrBusy(true);
    setMrOk(""); setMrError(""); setMrPayload(null);
    try {
      const res = await fetch(
        `${API}/api/admin/release-booking/${encodeURIComponent(mrBookingId.trim())}`,
        { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } }
      );
      const json = await res.json();
      setMrPayload(json);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Release failed");
      }
      setMrOk(
        json.alreadyReleased
          ? "Already released earlier."
          : `Released ₦${((json.releasedKobo || 0) / 100).toLocaleString()} to Available.`
      );
    } catch (e) {
      setMrError(e.message || "Release failed");
    } finally {
      setMrBusy(false);
    }
  }

  // ---------- lifecycle ----------
  useEffect(() => {
    if (tab === "pending") loadPending();
    if (tab === "settings") loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <p className="text-zinc-400 mt-1">
        Review pro applications and configure how the platform runs itself.
      </p>

      {/* Tabs */}
      <div className="mt-6 border-b border-zinc-800 flex gap-6">
        <TabButton active={tab === "pending"} onClick={() => switchTab("pending")}>
          Pending Applications
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => switchTab("settings")}>
          System Settings
        </TabButton>
      </div>

      {/* Content */}
      <div className="mt-6">
        {tab === "pending" ? (
          <section className="space-y-4">
            {/* Controls */}
            <div className="flex items-center gap-3">
              <input
                placeholder="Search by name/email/phone/LGA…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full md:w-96 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
              />
              <button
                onClick={loadPending}
                className="rounded-lg border border-zinc-700 px-4 py-2"
                disabled={listLoading}
              >
                {listLoading ? "Loading…" : "Reload"}
              </button>
            </div>

            {listError && (
              <div className="rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
                {listError}
              </div>
            )}

            {listLoading ? (
              <div>Loading…</div>
            ) : !filtered.length ? (
              <div>No pending applications.</div>
            ) : (
              <div className="grid gap-3">
                {filtered.map((p) => {
                  const id = p.clientId || p._id;
                  const services =
                    Array.isArray(p?.professional?.services) && p.professional.services.length
                      ? p.professional.services.join(", ")
                      : p.services || "—";

                  const displayName =
                    p.displayName ||
                    [p?.identity?.firstName, p?.identity?.lastName].filter(Boolean).join(" ") ||
                    "(none)";

                  const lga =
                    (p.lga || p?.identity?.city || p?.identity?.state || "(none)")?.toString();

                  return (
                    <div key={id} className="rounded-xl border border-zinc-800 p-4">
                      <div className="grid md:grid-cols-2 gap-2">
                        <Row label="Name" value={displayName} />
                        <Row label="Email" value={p.email || "(none)"} />
                        <Row label="Phone" value={p.phone || p?.identity?.phone || "(none)"} />
                        <Row label="LGA" value={lga} />
                        <Row label="Services" value={services} />
                        <div className="text-xs text-zinc-500 break-all">
                          <strong>clientId:</strong> {p.clientId || "(none)"} &nbsp;|&nbsp;
                          <strong>_id:</strong> {p._id}
                        </div>
                      </div>

                      <div className="mt-4 flex gap-2 flex-wrap">
                        <button
                          onClick={() => approve(id)}
                          disabled={busyId === id}
                          className="px-4 py-2 rounded-lg bg-[#d4af37] text-black font-semibold disabled:opacity-60"
                          title="Approve this application"
                        >
                          {busyId === id ? "Approving..." : "Approve"}
                        </button>

                        <Link
                          to={`/admin/decline/${id}`}
                          className="px-4 py-2 rounded-lg border border-red-500 text-red-400"
                          title="Decline and provide a reason"
                        >
                          Decline
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-4">
            {/* Settings */}
            {sError && (
              <div className="rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
                {sError}
              </div>
            )}
            {sOk && (
              <div className="rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">
                {sOk}
              </div>
            )}

            {sLoading || !settings ? (
              <div>Loading settings…</div>
            ) : (
              <div className="grid gap-6">
                {/* Brand */}
                <Card title="Brand">
                  <Input
                    label="App Name"
                    value={settings.appName || ""}
                    onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                  />
                  <Input
                    label="Tagline"
                    value={settings.tagline || ""}
                    onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
                  />
                </Card>

                {/* Commission */}
                <Card title="Commission Split">
                  <div className="grid md:grid-cols-2 gap-3">
                    <Input
                      label="Platform %"
                      type="number"
                      value={settings?.commissionSplit?.platform ?? 25}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          commissionSplit: {
                            ...(settings.commissionSplit || {}),
                            platform: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <Input
                      label="Pro %"
                      type="number"
                      value={settings?.commissionSplit?.pro ?? 75}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          commissionSplit: {
                            ...(settings.commissionSplit || {}),
                            pro: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </Card>

                {/* Payouts */}
                <Card title="Payouts">
                  <div className="grid md:grid-cols-2 gap-3">
                    <Input
                      label="Release Days (pending → available)"
                      type="number"
                      value={settings?.payouts?.releaseDays ?? 7}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payouts: {
                            ...(settings.payouts || {}),
                            releaseDays: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <Input
                      label="Instant Cashout Fee %"
                      type="number"
                      value={settings?.payouts?.instantCashoutFeePercent ?? 3}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payouts: {
                            ...(settings.payouts || {}),
                            instantCashoutFeePercent: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings?.payouts?.enableAutoRelease}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payouts: { ...(settings.payouts || {}), enableAutoRelease: e.target.checked },
                        })
                      }
                    />
                    <span className="text-sm">Enable Auto-Release (pending → available)</span>
                  </div>
                  <Input
                    label="Auto-Release CRON (server time)"
                    placeholder="0 2 * * *"
                    value={settings?.payouts?.autoReleaseCron || "0 2 * * *"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        payouts: { ...(settings.payouts || {}), autoReleaseCron: e.target.value },
                      })
                    }
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Tip: <code className="bg-zinc-900 px-1 py-0.5 rounded">0 2 * * *</code> = 02:00 daily.
                  </p>
                </Card>

                {/* Withdrawals */}
                <Card title="Withdrawals">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings?.withdrawals?.requireApproval}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          withdrawals: {
                            ...(settings.withdrawals || {}),
                            requireApproval: e.target.checked,
                          },
                        })
                      }
                    />
                    <span className="text-sm">Require Admin Approval</span>
                  </div>
                </Card>

                {/* Maintenance */}
                <Card title="Maintenance">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings?.maintenance?.isMaintenanceMode}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          maintenance: {
                            ...(settings.maintenance || {}),
                            isMaintenanceMode: e.target.checked,
                          },
                        })
                      }
                    />
                    <span className="text-sm">Maintenance Mode</span>
                  </div>
                  <Input
                    label="Message"
                    value={settings?.maintenance?.message || ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        maintenance: { ...(settings.maintenance || {}), message: e.target.value },
                      })
                    }
                  />
                </Card>

                {/* Security */}
                <Card title="Security">
                  <label className="block text-xs text-zinc-400 mb-1">
                    Allowed Origins (CORS) — comma separated. These merge with your .env CORS_ORIGIN.
                  </label>
                  <input
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    value={(settings?.security?.allowedOrigins || []).join(", ")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        security: {
                          ...(settings.security || {}),
                          allowedOrigins: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    placeholder="http://localhost:5173, https://yourapp.com"
                  />
                </Card>

                {/* Manual Release (admin tool) */}
                <Card title="Manual Release (single booking)">
                  <p className="text-sm text-zinc-400 mb-2">
                    Move a booking’s pro share from <em>Pending</em> to <em>Available</em>.
                    Use this for special cases or support.
                  </p>
                  {mrError && (
                    <div className="rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2 mb-2">
                      {mrError}
                    </div>
                  )}
                  {mrOk && (
                    <div className="rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2 mb-2">
                      {mrOk}
                    </div>
                  )}
                  <div className="flex gap-2 flex-col sm:flex-row">
                    <input
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2"
                      placeholder="Booking ID (Mongo _id)"
                      value={mrBookingId}
                      onChange={(e) => setMrBookingId(e.target.value)}
                    />
                    <button
                      onClick={manualReleaseNow}
                      disabled={!mrBookingId.trim() || mrBusy}
                      className="px-4 py-2 rounded border border-zinc-700 hover:bg-zinc-900"
                    >
                      {mrBusy ? "Releasing…" : "Release now"}
                    </button>
                  </div>
                  {mrPayload && (
                    <pre className="mt-3 text-xs bg-zinc-950 border border-zinc-800 rounded p-3 overflow-auto">
{JSON.stringify(mrPayload, null, 2)}
                    </pre>
                  )}
                </Card>

                <div className="flex gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={sSaving}
                    className="px-4 py-2 rounded-lg bg-white text-black disabled:opacity-60"
                  >
                    {sSaving ? "Saving…" : "Save Settings"}
                  </button>
                  <button
                    onClick={loadSettings}
                    disabled={sSaving}
                    className="px-4 py-2 rounded-lg border border-zinc-700"
                  >
                    Reload
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/* ---------------- UI bits ---------------- */
function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${
        active
          ? "border-white text-white"
          : "border-transparent text-zinc-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div className="text-sm">
      <span className="text-zinc-400">{label}:</span>{" "}
      <span className="text-zinc-200">{value || "—"}</span>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-zinc-800 p-4">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Input({ label, ...rest }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
        {...rest}
      />
    </label>
  );
}
