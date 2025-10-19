import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function ClientWallet() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [me, setMe] = useState(null);
  const [creditsKobo, setCreditsKobo] = useState(0);
  const [txns, setTxns] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const { data: meData } = await api.get("/api/me");
        if (!alive) return;
        setMe(meData);

        // Read-only client wallet/credits (safe even if not implemented server-side).
        try {
          const { data } = await api.get("/api/wallet/client/me");
          if (alive) {
            setCreditsKobo(Number(data?.creditsKobo || 0));
            setTxns(Array.isArray(data?.transactions) ? data.transactions : []);
          }
        } catch {
          /* leave defaults; page stays read-only */
        }
      } catch {
        if (alive) setErr("Failed to load wallet.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const fmtNaira = (k) => `₦${Math.floor((Number(k) || 0) / 100).toLocaleString()}`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wallet</h1>
        {!me?.isPro && (
          <span className="text-xs text-zinc-400">
            This is your <b>client</b> wallet (credits & refunds). No withdrawals.
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
            <Card title="Saved cards">
              <div className="text-sm text-zinc-400">
                Cards are saved by Paystack during checkout.
              </div>
            </Card>
            <Card title="Refunds / Promos">
              <div className="text-sm text-zinc-400">
                If we issue a refund or promo, the amount will appear as Credits.
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
                  {txns.map((t) => (
                    <li key={t.id || `${t.ts}-${t.amountKobo}`} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm">{t.type || "entry"}</div>
                        <div className="text-xs text-zinc-500">{new Date(t.ts).toLocaleString()}</div>
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
