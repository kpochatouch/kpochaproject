// apps/web/src/pages/ClientWallet.jsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

function usePaystackScript() {
  const [ready, setReady] = useState(!!window.PaystackPop);
  useEffect(() => {
    if (window.PaystackPop) { setReady(true); return; }
    const id = "paystack-inline-sdk";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    s.onload = () => setReady(!!window.PaystackPop);
    s.onerror = () => setReady(false);
    document.body.appendChild(s);
  }, []);
  return ready;
}

export default function ClientWallet() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [me, setMe] = useState(null);
  const [creditsKobo, setCreditsKobo] = useState(0);
  const [txns, setTxns] = useState([]);

  // top-up UI
  const [topupNaira, setTopupNaira] = useState("");
  const [busyTopup, setBusyTopup] = useState(false);
  const paystackReady = usePaystackScript();

  // ---------- helpers ----------
  const fmtNaira = (k) => `₦${Math.floor((Number(k) || 0) / 100).toLocaleString()}`;
  const refreshWallet = async () => {
    const { data } = await api.get("/api/wallet/client/me");
    setCreditsKobo(Number(data?.creditsKobo || 0));
    setTxns(Array.isArray(data?.transactions) ? data.transactions : []);
  };

  // ---------- initial load ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const { data: meData } = await api.get("/api/me");
        if (!alive) return;
        setMe(meData);

        try {
          await refreshWallet();
        } catch {}
      } catch {
        if (alive) setErr("Failed to load wallet.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ---------- handle Paystack redirect back (?reference=...) ----------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference");
    if (!reference) return;

    let on = true;
    (async () => {
      try {
        setErr("");
        await api.get("/api/wallet/topup/verify", { params: { reference } });
        if (!on) return;
        await refreshWallet();
        // Clean the URL (remove the reference param) for a tidy state
        const url = new URL(window.location.href);
        url.searchParams.delete("reference");
        window.history.replaceState({}, "", url.toString());
      } catch (e) {
        if (!on) return;
        setErr(e?.response?.data?.error || "Could not verify top-up.");
      }
    })();
    return () => { on = false; };
  }, []);

   // ---------- inline flow ----------
async function startTopupInline(amountKobo) {
  const pubKey = String(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || "");
  if (!pubKey || !window.PaystackPop || typeof window.PaystackPop.setup !== "function") {
    throw new Error("inline_not_ready");
  }

  return new Promise((resolve, reject) => {
    const handler = window.PaystackPop.setup({
      key: pubKey,
      email: me?.email || "customer@example.com",
      amount: Number(amountKobo),
      ref: `TOPUP-${me?.uid || "anon"}-${Date.now()}`,
      metadata: {
        custom_fields: [
          { display_name: "Topup", variable_name: "topup", value: String(amountKobo) },
        ],
      },

      callback: function (response) {
        (async () => {
          try {
            const verify = await api.get("/api/wallet/topup/verify", {
            params: { reference: response.reference },
          });

            if (verify?.data?.ok) {
              await refreshWallet();
              setTopupNaira("");
              resolve();
            } else {
              reject(new Error("verify_failed"));
            }
          } catch (e) {
            reject(e);
          }
        })();
      },

      onClose: function () {
        reject(new Error("payment_cancelled"));
      },
    });

    handler.openIframe();
  });
}


  // ---------- redirect/init flow ----------
  async function startTopupRedirect(amountKobo) {
    const { data } = await api.get("/api/wallet/topup/init", {
    params: { amountKobo },
   });

    if (!data?.authorization_url) throw new Error("init_failed");
    // Optional: stash context if you want to show a message on return
    sessionStorage.setItem("topup_pending", String(amountKobo));
    window.location.href = data.authorization_url;
  }

  // ---------- top-up button handler ----------
  async function startTopup() {
    setErr("");
    const naira = Number(topupNaira);
    if (!naira || naira <= 0) { setErr("Enter a valid amount."); return; }
    const kobo = Math.round(naira * 100);

    try {
      setBusyTopup(true);
      // Try inline first; if not ready or pubkey missing, fall back to redirect
      try {
        if (!paystackReady) throw new Error("inline_not_ready");
        await startTopupInline(kobo);
        setTopupNaira("");
      } catch {
        await startTopupRedirect(kobo);
      }
    } catch (e) {
      setErr("Could not start top-up.");
      setBusyTopup(false); // only unset if we didn't redirect away
      return;
    }
    setBusyTopup(false);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wallet</h1>
        {!me?.isPro && (
          <span className="text-xs text-zinc-400">
            This is your <b>client</b> wallet (credits &amp; refunds). No withdrawals.
          </span>
        )}
      </div>

      {err && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 text-red-100 px-3 py-2 mt-4">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-400 mt-4">Loading…</div>
      ) : (
        <>
          <section className="grid sm:grid-cols-3 gap-4 mt-6">
            <Card title="Credits (usable for bookings)">
              <div className="text-2xl font-semibold">{fmtNaira(creditsKobo)}</div>
            </Card>

            <Card title="Top up">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">₦</span>
                <input
                  type="number"
                  min="0"
                  className="w-28 bg-black border border-zinc-800 rounded px-2 py-1"
                  value={topupNaira}
                  onChange={(e) => setTopupNaira(e.target.value)}
                  placeholder="Amount"
                />
                <button
                  onClick={startTopup}
                  disabled={busyTopup}
                  className="rounded bg-gold text-black px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                >
                  {busyTopup ? "Starting…" : "Add funds"}
                </button>
              </div>
              <div className="text-xs text-zinc-500 mt-1">Powered by Paystack</div>
            </Card>

            <Card title="Saved cards">
              <div className="text-sm text-zinc-400">
                Cards are saved by Paystack during checkout.
              </div>
            </Card>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold mb-2">Recent Activity</h2>
            <div className="rounded-lg border border-zinc-800">
              {txns.length === 0 ? (
                <div className="px-4 py-6 text-zinc-400">No activity yet.</div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {txns.map((t, i) => (
                    <li
                      key={t.id || `${t.ts || ""}-${t.amountKobo || 0}-${i}`}
                      className="px-4 py-3 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-sm capitalize">{t.type || "entry"}</div>
                        <div className="text-xs text-zinc-500">
                          {t.ts ? new Date(t.ts).toLocaleString() : ""}
                        </div>
                      </div>
                      <div className="font-mono">{fmtNaira(t.amountKobo)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-4 bg-black/40">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
