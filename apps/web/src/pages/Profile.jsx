// apps/web/src/pages/Profile.jsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError("");

        const { data: meData } = await api.get("/api/me");
        if (!mounted) return;
        setMe(meData);

        // Optional: profile router may not exist in all envs
        try {
          const { data: profData } = await api.get("/api/profile/me");
          if (mounted) setClientProfile(profData || null);
        } catch {
          if (mounted) setClientProfile(null);
        }
      } catch {
        if (mounted) setError("Please sign in to view your profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function maskId(id = "") {
    const s = String(id).trim();
    if (s.length <= 4) return "****";
    return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  }

  const displayName =
    clientProfile?.fullName ||
    me?.displayName ||
    me?.email ||
    "Your Account";

  const avatarUrl = clientProfile?.photoUrl || me?.photoUrl || "";
  const phone = clientProfile?.phone || me?.phone || "";

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Avatar url={avatarUrl} seed={me?.email || me?.uid} />
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
            title="Open Settings"
          >
            Edit Profile →
          </a>
          <a
            href="/wallet"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
            title="Open Wallet"
          >
            Wallet →
          </a>
        </div>
      </div>

      {/* States */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/40 text-red-100 px-3 py-2 mb-6">
          {error}
        </div>
      )}
      {loading && <div className="text-zinc-400">Loading…</div>}
      {!loading && !error && !me && (
        <div className="rounded-lg border border-zinc-800 px-4 py-6 text-zinc-400">
          No profile data found.
        </div>
      )}

      {!loading && me && (
        <div className="space-y-6">
          {/* Account details */}
          <Section title="Account Details">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="Email" value={me.email || "—"} />
              <ReadOnly label="Phone" value={phone || "—"} />
              <ReadOnly label="Preferred LGA / City" value={clientProfile?.lga || me?.lga || "—"} />
              <ReadOnly label="User ID" value={me.uid} mono />
            </div>

            {/* (Optional) Deactivation status surfaced from /api/me */}
            {typeof me.deactivationStatus !== "undefined" && (
              <div className="mt-3 grid sm:grid-cols-2 gap-4">
                <ReadOnly
                  label="Account Deactivation"
                  value={
                    me.deactivationStatus
                      ? me.deactivationStatus === "pending"
                        ? "Pending"
                        : me.deactivationStatus
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
            hint="Only visible to admins and to a professional who has accepted your booking. Never shown publicly."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="House Address" value={clientProfile?.houseAddress || "—"} />
              <ReadOnly
                label="Means of ID"
                value={
                  clientProfile?.idType
                    ? `${clientProfile.idType}${
                        clientProfile.idNumber ? ` (${maskId(clientProfile.idNumber)})` : ""
                      }`
                    : "—"
                }
              />
              <ReadOnly
                label="ID Verified"
                value={clientProfile ? (clientProfile.idVerified ? "Yes" : "Not verified") : "—"}
              />
            </div>
          </Section>

          {/* Professional block */}
          <Section title="Professional">
            {me.isPro ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-zinc-300">
                    ✅ Approved{me.proName ? ` — ${me.proName}` : ""}{me.lga ? ` (${me.lga})` : ""}
                  </div>
                  <a
                    href="/pro"
                    className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold hover:opacity-90"
                  >
                    Open Pro Dashboard
                  </a>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  {me.proId && <ReadOnly label="Pro ID" value={me.proId} mono />}
                  <ReadOnly label="Public Name" value={me.proName || "—"} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-300">You’re not a professional yet.</div>
                {/* ✅ Link to /apply for the best UX (direct route in App.jsx) */}
                <a
                  href="/apply"
                  className="rounded-lg border border-gold px-3 py-1.5 text-sm hover:bg-gold hover:text-black"
                >
                  Become a Pro
                </a>
              </div>
            )}
          </Section>

          {/* Security overview */}
          <Section title="Security & Wallet">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="Wallet PIN" value={me.hasPin ? "Set" : "Not set"} />
              <ReadOnly label="Admin" value={me.isAdmin ? "Yes" : "No"} />
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

/* ------------------------------ UI bits ------------------------------ */

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
      <div className={`mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 ${mono ? "font-mono break-all" : ""}`}>
        {value || "—"}
      </div>
    </label>
  );
}

function Avatar({ url, seed }) {
  if (url) {
    return (
      <img
        src={url}
        alt="Profile"
        className="w-14 h-14 rounded-full border border-zinc-800 object-cover"
      />
    );
  }
  const initials =
    (seed || "?")
      .split("@")[0]
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
