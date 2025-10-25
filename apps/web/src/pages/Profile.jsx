// apps/web/src/pages/Profile.jsx
import { useEffect, useState } from "react";
import { getMe } from "../lib/api"; // ✅ use cached getMe instead of api.get("/api/me")
import { api } from "../lib/api";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);
  const [pro, setPro] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");

        // ✅ Cached getMe() — prevents /api/me spam
        const meData = await getMe();
        if (!alive) return;
        setMe(meData || null);

        // Optional extra info
        try {
          const { data: clientData } = await api.get("/api/profile/client/me");
          if (alive) setClient(clientData || null);
        } catch {
          if (alive) setClient(null);
        }

        try {
          const { data: proData } = await api.get("/api/pros/me");
          if (alive) setPro(proData || null);
        } catch {
          if (alive) setPro(null);
        }
      } catch {
        if (alive) setError("Please sign in to view your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // ✅ Only runs once on mount

  // ---------- helpers ----------
  function maskId(id = "") {
    const s = String(id || "").trim();
    if (!s) return "—";
    if (s.length <= 4) return "****";
    return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  }

  const email = me?.email || "";
  const username =
    me?.username || me?.usernameLC || me?.userName || me?.user || me?.uid || "—";
  const displayName =
    client?.fullName ||
    me?.displayName ||
    (email ? email.split("@")[0] : "Your Account");
  const avatarUrl = client?.photoUrl || me?.photoUrl || "";
  const phone = client?.phone || me?.phone || "";
  const preferredLga = client?.lga || me?.lga || "—";
  const houseAddress = client?.houseAddress || client?.address || "—";

  const idType = client?.kyc?.idType || client?.idType || "";
  const idNumber = client?.kyc?.idNumber || client?.idNumber || "";
  const idVerified =
    typeof client?.kyc?.status === "string"
      ? client.kyc.status === "verified"
      : !!client?.idVerified;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Avatar url={avatarUrl} seed={email || username} />
          <div>
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            <p className="text-zinc-400 text-sm">
              Personal profile • Manage your account and booking details
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href="/settings"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
          >
            Edit Profile →
          </a>
          <a
            href="/wallet"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
          >
            Wallet →
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/40 text-red-100 px-3 py-2 mb-6">
          {error}
        </div>
      )}
      {loading && <div className="text-zinc-400">Loading…</div>}

      {!loading && !error && (
        <div className="space-y-6">
          {/* Account details */}
          <Section title="Account Details">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="Email" value={email || "—"} />
              <ReadOnly label="Phone" value={phone || "—"} />
              <ReadOnly label="Preferred LGA / City" value={preferredLga || "—"} />
              <ReadOnly label="Username / ID" value={username} mono />
            </div>

            {/* Deactivation */}
            {typeof me?.deactivationStatus !== "undefined" && (
              <div className="mt-3 grid sm:grid-cols-2 gap-4">
                <ReadOnly
                  label="Account Deactivation"
                  value={
                    me.deactivationStatus
                      ? me.deactivationStatus === "pending"
                        ? "Pending"
                        : String(me.deactivationStatus)
                      : "—"
                  }
                />
                <div className="flex items-end">
                  <a
                    href="/deactivate"
                    className="text-sm px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900"
                  >
                    Request Deactivation
                  </a>
                </div>
              </div>
            )}
          </Section>

          {/* Private client info */}
          <Section
            title="Private Client Info"
            hint="Only visible to you, admins, and a professional who has accepted your booking."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="House Address" value={houseAddress} />
              <ReadOnly
                label="Means of ID"
                value={idType ? `${idType}${idNumber ? ` (${maskId(idNumber)})` : ""}` : "—"}
              />
              <ReadOnly
                label="ID Verified"
                value={client ? (idVerified ? "Yes" : "Not verified") : "—"}
              />
            </div>
          </Section>

          {/* Professional */}
          <Section title="Professional">
            {me?.isPro || pro?.id ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-zinc-300">
                    ✅ Approved
                    {me?.proName ? ` — ${me.proName}` : ""}
                    {me?.lga ? ` (${me.lga})` : ""}
                  </div>
                  <a
                    href="/pro"
                    className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold hover:opacity-90"
                  >
                    Open Pro Dashboard
                  </a>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  {me?.proId && <ReadOnly label="Pro ID" value={me.proId} mono />}
                  <ReadOnly label="Public Name" value={me?.proName || "—"} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-300">You’re not a professional yet.</div>
                <a
                  href="/apply"
                  className="rounded-lg border border-gold px-3 py-1.5 text-sm hover:bg-gold hover:text-black"
                >
                  Become a Pro
                </a>
              </div>
            )}
          </Section>

          {/* Security */}
          <Section title="Security & Wallet">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="Wallet PIN" value={me?.hasPin ? "Set" : "Not set"} />
              <ReadOnly label="Admin" value={me?.isAdmin ? "Yes" : "No"} />
            </div>
            <div className="flex gap-2 mt-4">
              <a href="/wallet" className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-sm">
                Manage Wallet / PIN
              </a>
              <a href="/settings" className="rounded-lg border border-zinc-700 hover:bg-zinc-900 px-3 py-2 text-sm">
                Account Settings
              </a>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

/* ------------------ UI helpers ------------------ */
function Section({ title, hint, children }) {
  return (
    <section className="rounded-lg border border-zinc-800 p-4 bg-black/40">
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      {hint && <p className="text-xs text-zinc-500 mb-3">{hint}</p>}
      {children}
    </section>
  );
}
function ReadOnly({ label, value, mono }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <div
        className={`mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 ${
          mono ? "font-mono break-all" : ""
        }`}
      >
        {value || "—"}
      </div>
    </label>
  );
}
function Avatar({ url, seed }) {
  if (url)
    return (
      <img
        src={url}
        alt="Profile"
        className="w-14 h-14 rounded-full border border-zinc-800 object-cover"
      />
    );
  const base = String(seed || "?").split("@")[0];
  const initials =
    base
      .split(/[.\-_ ]+/)
      .slice(0, 2)
      .map((s) => s?.[0]?.toUpperCase())
      .join("") || "?";
  return (
    <div className="w-14 h-14 rounded-full border border-zinc-800 bg-zinc-900 flex items-center justify-center text-lg font-semibold">
      {initials}
    </div>
  );
}
