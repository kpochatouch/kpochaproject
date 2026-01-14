// apps/web/src/components/AdminPayoutSettings.jsx

import { useEffect, useState } from "react";
import {
  getSettings,
  updateSettingsAdmin,
  adminReleaseBooking,
} from "../../lib/api";

export default function AdminPayoutSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    payouts: {
      releaseDays: 7,
      instantCashoutFeePercent: 3,
      enableAutoRelease: true,
      autoReleaseCron: "0 2 * * *",
    },
    bookingRules: {
      noShowStrikeLimit: 2,
      enableNoShowSweep: true,
      noShowSweepCron: "0 3 * * *",
    },
  });

  const [bookingId, setBookingId] = useState("");
  const [releaseResult, setReleaseResult] = useState(null);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      setMsg("");
      try {
        const { data } = await getSettings();
        setForm((p) => ({
          ...p,
          payouts: { ...p.payouts, ...(data?.payouts || {}) },
          bookingRules: { ...p.bookingRules, ...(data?.bookingRules || {}) },
        }));
      } catch (e) {
        console.error(e);
        setErr("Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const payload = {
        payouts: {
          releaseDays: Number(form.payouts.releaseDays) || 7,
          instantCashoutFeePercent:
            Number(form.payouts.instantCashoutFeePercent) || 3,
          enableAutoRelease: !!form.payouts.enableAutoRelease,
          autoReleaseCron: String(form.payouts.autoReleaseCron || "0 2 * * *"),
        },
        bookingRules: {
          noShowStrikeLimit: Number(form.bookingRules.noShowStrikeLimit) || 2,
          enableNoShowSweep: !!form.bookingRules.enableNoShowSweep,
          noShowSweepCron: String(
            form.bookingRules.noShowSweepCron || "0 3 * * *",
          ),
        },
      };
      await updateSettingsAdmin(payload);
      setMsg("Settings saved and schedulers restarted.");
    } catch (e) {
      console.error(e);
      setErr("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function manualRelease() {
    setReleasing(true);
    setErr("");
    setMsg("");
    setReleaseResult(null);
    try {
      const { data } = await adminReleaseBooking(bookingId.trim());
      setReleaseResult(data);
      if (data?.ok) {
        setMsg(
          data.alreadyReleased
            ? "Already released earlier."
            : `Released ₦${((data.releasedKobo || 0) / 100).toLocaleString()} to Available.`,
        );
      } else {
        setErr(data?.error || "Release failed.");
      }
    } catch (e) {
      console.error(e);
      setErr("Release failed.");
    } finally {
      setReleasing(false);
    }
  }

  if (loading)
    return (
      <div className="rounded border border-zinc-800 p-4">
        Loading settings…
      </div>
    );

  return (
    <section className="rounded-lg border border-zinc-800 p-4 space-y-6">
      <h3 className="text-lg font-semibold">Payouts & Auto-Release</h3>

      {msg && <div className="text-green-400 text-sm">{msg}</div>}
      {err && <div className="text-red-400 text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Release to Available after (days)">
          <input
            type="number"
            min="1"
            className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
            value={form.payouts.releaseDays}
            onChange={(e) =>
              setForm({
                ...form,
                payouts: { ...form.payouts, releaseDays: e.target.value },
              })
            }
          />
        </Field>

        <Field label="Instant cashout fee (%)">
          <input
            type="number"
            min="0"
            className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
            value={form.payouts.instantCashoutFeePercent}
            onChange={(e) =>
              setForm({
                ...form,
                payouts: {
                  ...form.payouts,
                  instantCashoutFeePercent: e.target.value,
                },
              })
            }
          />
        </Field>

        <Field label="Enable auto-release">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form.payouts.enableAutoRelease}
              onChange={(e) =>
                setForm({
                  ...form,
                  payouts: {
                    ...form.payouts,
                    enableAutoRelease: e.target.checked,
                  },
                })
              }
            />
            Turn on nightly scheduler
          </label>
        </Field>

        <Field label="Auto-release CRON (UTC)">
          <input
            className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
            value={form.payouts.autoReleaseCron}
            onChange={(e) =>
              setForm({
                ...form,
                payouts: { ...form.payouts, autoReleaseCron: e.target.value },
              })
            }
            placeholder="0 2 * * *"
          />
        </Field>
      </div>

      <div>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-gold text-black font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      <hr className="border-zinc-800" />

      <h4 className="font-semibold">Manual Release (single booking)</h4>
      <p className="text-sm text-zinc-400 mb-2">
        Move this booking’s pro share from <em>Pending</em> to{" "}
        <em>Available</em>.
      </p>

      <div className="flex gap-2 flex-col sm:flex-row">
        <input
          className="flex-1 bg-black border border-zinc-800 rounded px-3 py-2"
          placeholder="Booking ID (Mongo _id)"
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
        />
        <button
          onClick={manualRelease}
          disabled={!bookingId.trim() || releasing}
          className="px-4 py-2 rounded border border-zinc-700 hover:bg-zinc-900"
        >
          {releasing ? "Releasing…" : "Release now"}
        </button>
      </div>

      {releaseResult && (
        <pre className="mt-3 text-xs bg-zinc-950 border border-zinc-800 rounded p-3 overflow-auto">
          {JSON.stringify(releaseResult, null, 2)}
        </pre>
      )}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-sm text-zinc-300 mb-1">{label}</div>
      {children}
    </label>
  );
}
