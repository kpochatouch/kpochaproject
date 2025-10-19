// apps/web/src/pages/Wallet.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  getAuth,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";

export default function WalletPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [me, setMe] = useState(null);
  const [meHasPin, setMeHasPin] = useState(false);

  const [wallet, setWallet] = useState(null);
  const [tx, setTx] = useState([]);

  const [amtFromPending, setAmtFromPending] = useState("");
  const [amtFromAvailable, setAmtFromAvailable] = useState("");

  // settings (best-effort)
  const [settings, setSettings] = useState(null);
  const feePct = useMemo(
    () => Number(settings?.payouts?.instantCashoutFeePercent ?? 3),
    [settings]
  );
  const autoReleaseOn = !!settings?.payouts?.enableAutoRelease;

  // modals
  const [pinModal, setPinModal] = useState({ open: false, mode: "set" }); // "set" | "reset"
  const [pinPrompt, setPinPrompt] = useState({ open: false, onSubmit: null, error: "" });
  const [forgotOpen, setForgotOpen] = useState(false);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const [meRes, wRes, sRes] = await Promise.allSettled([
        api.get("/api/me"),
        api.get("/api/wallet/me"),
        api.get("/api/settings"),
      ]);
      const meData = meRes.status === "fulfilled" ? meRes.value.data : null;
      const wData  = wRes.status  === "fulfilled" ? wRes.value.data  : null;
      const sData  = sRes.status  === "fulfilled" ? sRes.value.data  : null;

      setMe(meData);
      setMeHasPin(!!meData?.hasPin);
      setWallet(wData?.wallet || null);
      setTx(wData?.transactions || []);
      setSettings(sData || null);
    } catch {
      setErr("Unable to load wallet. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const fmt = (k) => `₦${(Math.floor(k || 0) / 100).toLocaleString()}`;

  function openWithdrawPinPrompt(onSubmit) {
    setPinPrompt({ open: true, onSubmit, error: "" });
  }
  function showInvalidPin(code) {
    setPinPrompt((p) => ({
      ...p,
      error:
        code === "invalid_pin"
          ? "That PIN didn’t match. Try again, reset it, or choose Forgot PIN."
          : "PIN error. Please try again.",
    }));
  }

  // ----------------- Withdraw from Pending (fee) -----------------
  async function withdrawFromPending() {
    const naira = +amtFromPending || 0;
    if (naira <= 0) return alert("Enter a valid amount in ₦.");
    const max = (wallet?.pendingKobo || 0) / 100;
    if (naira > max) return alert(`You can withdraw at most ₦${max.toLocaleString()} from Pending.`);
    const amountKobo = Math.floor(naira * 100);

    openWithdrawPinPrompt(async (pin) => {
      try {
        await api.post("/api/wallet/withdraw-pending", { amountKobo, pin });
        setAmtFromPending("");
        setPinPrompt({ open: false, onSubmit: null, error: "" });
        await load();
      } catch (e) {
        showInvalidPin(e?.response?.data?.error);
      }
    });
  }

  // ----------------- Withdraw from Available -----------------
  async function withdrawFromAvailable() {
    const naira = +amtFromAvailable || 0;
    if (naira <= 0) return alert("Enter a valid amount in ₦.");
    const max = (wallet?.availableKobo || 0) / 100;
    if (naira > max) return alert(`You can withdraw at most ₦${max.toLocaleString()} from Available.`);
    const amountKobo = Math.floor(naira * 100);

    openWithdrawPinPrompt(async (pin) => {
      try {
        await api.post("/api/wallet/withdraw", { amountKobo, pin });
        setAmtFromAvailable("");
        setPinPrompt({ open: false, onSubmit: null, error: "" });
        await load();
      } catch (e) {
        showInvalidPin(e?.response?.data?.error);
      }
    });
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold">Wallet</h2>

        <button
          onClick={() => setPinModal({ open: true, mode: meHasPin ? "reset" : "set" })}
          className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1"
          title={meHasPin ? "Reset your wallet PIN" : "Set your wallet PIN"}
        >
          {meHasPin ? "Reset PIN" : "Set PIN"}
        </button>
      </div>

      <p className="text-zinc-400 mt-2">
        Earnings appear in <span className="inline-block px-2 bg-zinc-800 rounded">Pending</span> after payment.
      </p>
      <p className="text-zinc-500 text-xs mt-1 mb-6">
        Instant cashout fee from Pending: <strong>{feePct}%</strong>
        <span className="mx-2">•</span>
        Auto-release:{" "}
        <strong className={autoReleaseOn ? "text-green-400" : "text-red-400"}>
          {autoReleaseOn ? "ON" : "OFF"}
        </strong>
      </p>

      {err && <div className="bg-red-900 text-red-100 rounded p-4 mb-6">{err}</div>}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card title="Pending" value={fmt(wallet?.pendingKobo)} />
            <Card title="Available" value={fmt(wallet?.availableKobo)} />
            <Card title="Withdrawn (lifetime)" value={fmt(wallet?.withdrawnKobo)} />
            <Card title="Earned (lifetime)" value={fmt(wallet?.earnedKobo)} />
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-8">
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={`Amount from Pending (₦) — ${feePct}% fee`}
                className="bg-black border border-zinc-800 rounded-lg px-3 py-2 w-72"
                value={amtFromPending}
                onChange={(e) => setAmtFromPending(e.target.value)}
              />
              <button
                onClick={withdrawFromPending}
                className="rounded-lg bg-gold text-black px-4 py-2 font-semibold"
                title={`Withdraw from Pending (${feePct}% fee)`}
              >
                Withdraw
              </button>
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount from Available (₦)"
                className="bg-black border border-zinc-800 rounded-lg px-3 py-2 w-64"
                value={amtFromAvailable}
                onChange={(e) => setAmtFromAvailable(e.target.value)}
              />
              <button
                onClick={withdrawFromAvailable}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 font-semibold"
                title="Withdraw from Available"
              >
                Withdraw
              </button>
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-3">Recent Transactions</h3>
          <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {(tx || []).map((t) => (
              <div key={t._id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-1 rounded bg-zinc-800">{t.type}</span>
                  {t.meta?.bookingId && (
                    <span className="text-xs px-2 py-1 rounded bg-zinc-900">
                      Booking: {String(t.meta.bookingId).slice(-6)}
                    </span>
                  )}
                  <span className="text-zinc-400 text-sm">
                    {new Date(t.createdAt).toLocaleString()}
                  </span>
                </div>
                <div
                  className={`${
                    t.direction === "credit"
                      ? "text-green-400"
                      : t.direction === "debit"
                      ? "text-red-400"
                      : "text-zinc-300"
                  } font-semibold`}
                >
                  {t.direction === "credit" ? "+" : t.direction === "debit" ? "−" : ""} {fmt(t.amountKobo)}
                </div>
              </div>
            ))}
            {(!tx || tx.length === 0) && <div className="p-6 text-zinc-400">No transactions yet.</div>}
          </div>
        </>
      )}

      {/* PIN modals */}
      <PinModal
        open={pinModal.open}
        mode={pinModal.mode}
        onClose={() => setPinModal((m) => ({ ...m, open: false }))}
        onDone={async () => {
          setPinModal((m) => ({ ...m, open: false }));
          await load();
          setMeHasPin(true);
        }}
      />

      <PinPrompt
        open={pinPrompt.open}
        error={pinPrompt.error}
        onClose={() => setPinPrompt({ open: false, onSubmit: null, error: "" })}
        onSubmit={pinPrompt.onSubmit}
        onResetPin={() => {
          setPinPrompt({ open: false, onSubmit: null, error: "" });
          setPinModal({ open: true, mode: meHasPin ? "reset" : "set" });
        }}
        onForgotPin={() => setForgotOpen(true)}
      />

      <ForgotPinModal
        open={forgotOpen}
        email={me?.email || ""}
        onClose={() => setForgotOpen(false)}
        onSetNewPin={async (newPin) => {
          // Requires tiny backend endpoint shown below
          await api.put("/api/pin/me/forgot", { newPin });
          setForgotOpen(false);
          setMeHasPin(true);
        }}
      />
    </div>
  );
}

/* ------------------------------ Components ------------------------------ */

function Card({ title, value }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="text-zinc-400 text-sm">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/** Set / Reset PIN in Wallet (old behavior retained) */
function PinModal({ open, mode, onClose, onDone }) {
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const isReset = mode === "reset";
  const pinsMatch = pin && pin === pin2;
  const canSubmit = isReset ? currentPin && pinsMatch : pinsMatch;

  async function submit() {
    if (!canSubmit || busy) return;
    try {
      setBusy(true);
      if (isReset) {
        await api.put("/api/pin/me/reset", { currentPin, newPin: pin });
      } else {
        await api.post("/api/pin/me/set", { pin });
      }
      onDone?.();
    } catch (e) {
      alert(e?.response?.data?.error || "PIN error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-black border border-zinc-800 rounded-xl p-5">
        <div className="text-lg font-semibold mb-3">
          {isReset ? "Reset Wallet PIN" : "Set Wallet PIN"}
        </div>

        {isReset && (
          <div className="mb-3">
            <label className="block text-sm mb-1">Current PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoComplete="new-password"
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}

        <div className="mb-3">
          <label className="block text-sm mb-1">New PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm mb-1">Confirm New PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 border rounded">Cancel</button>
          <button
            disabled={!canSubmit || busy}
            onClick={submit}
            className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save PIN"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Numeric PIN prompt for withdraws (no browser password popup) */
function PinPrompt({ open, error, onClose, onSubmit, onResetPin, onForgotPin }) {
  const [pin, setPin] = useState("");
  const disabled = !/^\d{4,6}$/.test(pin);
  useEffect(() => { if (!open) setPin(""); }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xs bg-black border border-zinc-800 rounded-xl p-5">
        <div className="text-lg font-semibold mb-2">Enter Wallet PIN</div>
        {error && <div className="text-sm text-red-300 mb-2">{error}</div>}
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="4–6 digits"
          className="w-full bg-black border border-zinc-800 rounded px-3 py-2 mb-3"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <div className="flex justify-end gap-2 mb-3">
          <button onClick={onClose} className="px-3 py-2 border rounded">Cancel</button>
          <button
            disabled={disabled}
            onClick={() => onSubmit?.(pin)}
            className="px-3 py-2 rounded bg-gold text-black disabled:opacity-50"
          >
            Continue
          </button>
        </div>

        <div className="text-xs flex items-center justify-between">
          <button className="underline text-zinc-400 hover:text-zinc-200" onClick={onResetPin}>
            Reset PIN
          </button>
          <button className="underline text-zinc-400 hover:text-zinc-200" onClick={onForgotPin}>
            Forgot PIN?
          </button>
        </div>
      </div>
    </div>
  );
}

/** Forgot PIN flow using Firebase re-auth, then set a new PIN (no admin) */
function ForgotPinModal({ open, email, onClose, onSetNewPin }) {
  const auth = getAuth();
  const [mode, setMode] = useState("choose"); // choose | pass | new | ok
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");

  useEffect(() => {
    if (!open) {
      setMode("choose"); setBusy(false); setErr("");
      setPassword(""); setNewPin(""); setNewPin2("");
    }
  }, [open]);

  if (!open) return null;

  async function verifyWithPassword() {
    try {
      setBusy(true); setErr("");
      const cred = EmailAuthProvider.credential(email, password);
      await reauthenticateWithCredential(auth.currentUser, cred);
      setMode("new");
    } catch (e) {
      setErr(e?.message || "Password verification failed.");
    } finally {
      setBusy(false);
    }
  }
  async function verifyWithGoogle() {
    try {
      setBusy(true); setErr("");
      await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
      setMode("new");
    } catch (e) {
      setErr(e?.message || "Google verification failed.");
    } finally {
      setBusy(false);
    }
  }
  async function setFreshPin() {
    if (!/^\d{4,6}$/.test(newPin)) return setErr("PIN must be 4–6 digits.");
    if (newPin !== newPin2) return setErr("PINs do not match.");
    try {
      setBusy(true); setErr("");
      await onSetNewPin(newPin); // calls /api/pin/me/forgot on the parent
      setMode("ok");
    } catch (e) {
      setErr(e?.response?.data?.error || "Unable to set new PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-black border border-zinc-800 rounded-xl p-5">
        {mode === "choose" && (
          <>
            <div className="text-lg font-semibold mb-2">Forgot PIN</div>
            <p className="text-sm text-zinc-400 mb-4">
              Verify your identity to set a new Wallet PIN.
            </p>
            {err && <div className="text-sm text-red-300 mb-2">{err}</div>}
            <div className="flex flex-col gap-2">
              <button
                className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700"
                onClick={() => setMode("pass")}
              >
                Verify with Password
              </button>
              <button
                className="px-3 py-2 rounded border border-zinc-700 hover:bg-zinc-900"
                onClick={verifyWithGoogle}
                disabled={busy}
              >
                Verify with Google
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-3 py-2 border rounded">Close</button>
            </div>
          </>
        )}

        {mode === "pass" && (
          <>
            <div className="text-lg font-semibold mb-2">Verify with Password</div>
            <div className="text-xs text-zinc-500 mb-1">{email}</div>
            {err && <div className="text-sm text-red-300 mb-2">{err}</div>}
            <input
              type="password"
              autoComplete="current-password"
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2 mb-3"
              placeholder="Account password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setMode("choose")} className="px-3 py-2 border rounded">
                Back
              </button>
              <button
                onClick={verifyWithPassword}
                disabled={!password || busy}
                className="px-3 py-2 rounded bg-gold text-black disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Verify"}
              </button>
            </div>
          </>
        )}

        {mode === "new" && (
          <>
            <div className="text-lg font-semibold mb-2">Set New PIN</div>
            {err && <div className="text-sm text-red-300 mb-2">{err}</div>}
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoComplete="new-password"
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2 mb-2"
              placeholder="New PIN (4–6 digits)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoComplete="new-password"
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2 mb-3"
              placeholder="Confirm New PIN"
              value={newPin2}
              onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ""))}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 border rounded">Cancel</button>
              <button
                onClick={setFreshPin}
                disabled={!/^\d{4,6}$/.test(newPin) || newPin !== newPin2 || busy}
                className="px-3 py-2 rounded bg-gold text-black disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}

        {mode === "ok" && (
          <>
            <div className="text-lg font-semibold mb-2">PIN Updated</div>
            <p className="text-sm text-zinc-400 mb-4">Your Wallet PIN was reset successfully.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
