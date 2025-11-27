// apps/web/src/pages/Profile.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // basic user
  const [me, setMe] = useState(null);
  // unified client profile (/api/profile/me)
  const [clientProfile, setClientProfile] = useState(null);
  // private pro (from /api/pros/me) → owner-only, includes contact
  const [proPrivate, setProPrivate] = useState(null);
  // public pro (from /api/barbers/:id) → what cards/public browse see
  const [proPublic, setProPublic] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError("");

        // 1) /api/me → base identity + role flags
        const { data: meData } = await api.get("/api/me");
        if (!mounted) return;
        setMe(meData);

        // 2) unified client profile (can fail silently)
        try {
          const { data: profData } = await api.get("/api/profile/me");
          if (mounted) setClientProfile(profData || null);
        } catch {
          if (mounted) setClientProfile(null);
        }

        // 3) pro data (if user is pro)
        if (meData?.pro?.id || meData?.isPro) {
          // private pro document
          try {
            const { data: proData } = await api.get("/api/pros/me");
            if (mounted) setProPrivate(proData || null);
          } catch {
            if (mounted) setProPrivate(null);
          }

          // public barber card shape
          const proId = meData?.pro?.id;
          if (proId) {
            try {
              const { data: pubData } = await api.get(`/api/barbers/${proId}`);
              if (mounted) setProPublic(pubData || null);
            } catch {
              if (mounted) setProPublic(null);
            }
          }
        }
      } catch {
        if (mounted) setError("Please sign in to view your profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  function maskId(id = "") {
    const s = String(id).trim();
    if (s.length <= 4) return "****";
    return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  }

  // unified display name
  const displayName =
    me?.displayName || clientProfile?.fullName || me?.email || "Your Account";

  // unified avatar
  const avatarUrl =
    clientProfile?.photoUrl || me?.photoUrl || me?.identity?.photoUrl || "";

  // unified phone (private to owner)
  const phone =
    clientProfile?.phone ||
    clientProfile?.identity?.phone ||
    me?.phone ||
    me?.identity?.phone ||
    "";

  const state =
    clientProfile?.state ||
    clientProfile?.identity?.state ||
    me?.identity?.state ||
    "";

  const lga =
    clientProfile?.lga ||
    clientProfile?.identity?.lga ||
    clientProfile?.identity?.city ||
    me?.lga ||
    me?.identity?.city ||
    "";

  // optional username (for future link sharing) – this is SAFE to show
  const username = clientProfile?.username || me?.username || "";

    const kyc = clientProfile?.kyc || {};
  const hasKyc =
    !!kyc.idType || !!kyc.idUrl || !!kyc.selfieWithIdUrl;

  const idVerifiedLabel = !clientProfile
    ? "—"
    : hasKyc
    ? "Verified"
    : "Not verified";


  const isPro = !!(me?.isPro || me?.pro);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Avatar url={avatarUrl} seed={me?.email || me?.uid} />
          <div>
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            <p className="text-zinc-400 text-sm">
              Personal profile • Manage what you and others can see
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to="/settings"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
            title="Open Settings"
          >
            Edit Profile →
          </Link>
          <Link
            to="/wallet"
            className="text-sm px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-900"
            title="Open Wallet"
          >
            Wallet →
          </Link>
        </div>
      </div>

      {/* States */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/40 text-red-100 px-3 py-2 mb-6">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="text-zinc-400 mb-4">Loading…</div>
      )}

      {!loading && !error && !me && (
        <div className="rounded-lg border border-zinc-800 px-4 py-6 text-zinc-400">
          No profile data found.
        </div>
      )}

      {!loading && me && (
        <div className="space-y-6">
          {/* Account details (always) */}
          <Section title="Account Details">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly label="Email" value={me.email || "—"} />
              <ReadOnly label="Phone" value={phone || "—"} />
              <ReadOnly label="Preferred State" value={state || "—"} />
              <ReadOnly label="Preferred LGA / City" value={lga || "—"} />
              {/* Username is OK to show; internal IDs stay hidden */}
              <ReadOnly
                label="Username"
                value={username || "Not set"}
              />
            </div>

            {/* Optional deactivation */}
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
                  <Link
                    to="/deactivate"
                    className="text-sm px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900"
                  >
                    Request Deactivation
                  </Link>
                </div>
              </div>
            )}
          </Section>

          {/* Client private block */}
          <Section
            title="Private Client Info"
            hint="Only you, admin, or a professional involved in your booking can see this. Not shown to the public."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly
                label="House Address"
                value={clientProfile?.address || "—"}
              />

                <ReadOnly
                  label="Means of ID"
                  value={kyc?.idType || "—"}
                />

                <ReadOnly
                  label="ID Verified"
                  value={idVerifiedLabel}
                />
            </div>
          </Section>

          {/* Pro sections */}
          <Section title="Professional Status">
            {isPro ? (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-zinc-300 flex flex-wrap gap-2">
                  <span>✅ You are an approved professional.</span>
                  {me?.pro?.status && (
                    <span className="text-zinc-500">
                      Status: {me.pro.status}
                    </span>
                  )}
                </div>
                <Link
                  to="/pro-dashboard"
                  className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold hover:opacity-90"
                >
                  Open Pro Dashboard
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-zinc-300">
                  You’re not a professional yet.
                </div>
                <Link
                  to="/become"
                  className="rounded-lg border border-gold px-3 py-1.5 text-sm hover:bg-gold hover:text-black"
                >
                  Become a Pro
                </Link>
              </div>
            )}
          </Section>

          {/* What the public sees about your pro profile */}
          {isPro && (
            <Section
              title="Your Pro Profile (Public View)"
              hint="This is the safe data shown on cards/browse. Contact details are NOT exposed here."
            >
              {proPublic ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <ReadOnly label="Name" value={proPublic.name || "—"} />
                    <ReadOnly
                      label="Location"
                      value={
                        [proPublic.state, proPublic.lga]
                          .filter(Boolean)
                          .join(", ") || "—"
                      }
                    />
                    <ReadOnly
                      label="Availability"
                      value={
                        typeof proPublic.availability === "string"
                          ? proPublic.availability
                          : "Available"
                      }
                    />
                    <ReadOnly
                      label="Rating (if any)"
                      value={
                        proPublic.rating && proPublic.rating > 0
                          ? `${proPublic.rating.toFixed(1)} / 5`
                          : "No reviews yet"
                      }
                    />
                  </div>

                  {/* top services */}
                  {Array.isArray(proPublic.services) &&
                    proPublic.services.length > 0 && (
                      <div>
                        <p className="text-xs text-zinc-500 mb-1">
                          Services (public):
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {proPublic.services.slice(0, 5).map((s, i) => (
                            <span
                              key={i}
                              className="inline-flex px-3 py-1 text-xs rounded-full bg-zinc-900 border border-zinc-800"
                            >
                              {s.name}
                              {typeof s.price === "number" &&
                                s.price > 0 &&
                                ` • ₦${s.price.toLocaleString()}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  We couldn’t load your public pro profile yet.
                </p>
              )}
            </Section>
          )}

          {/* Private pro details – only owner/admin should see (no raw IDs shown) */}
          {isPro && (
            <Section
              title="Pro Contact (Private)"
              hint="Only you, admin, or a booking counterpart should use these. We don’t show these on public cards."
            >
              {proPrivate ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  <ReadOnly
                    label="Public Phone"
                    value={
                      proPrivate?.contactPublic?.phone ||
                      proPrivate?.phone ||
                      "—"
                    }
                  />
                  <ReadOnly
                    label="Shop Address"
                    value={
                      proPrivate?.contactPublic?.shopAddress ||
                      proPrivate?.business?.shopAddress ||
                      "—"
                    }
                  />
                  <ReadOnly
                    label="WhatsApp"
                    value={proPrivate?.contactPublic?.whatsapp || "—"}
                  />
                  <ReadOnly
                    label="Private Alt Phone"
                    value={proPrivate?.contactPrivate?.altPhone || "—"}
                  />
                  {/* Pro ID / Owner UID intentionally NOT rendered */}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  You are a pro, but we couldn’t load your private contact
                  details yet.
                </p>
              )}
            </Section>
          )}

          {/* Security overview */}
          <Section title="Security & Wallet">
            <div className="grid sm:grid-cols-2 gap-4">
              <ReadOnly
                label="Wallet PIN"
                value={me.hasPin ? "Set" : "Not set"}
              />
              <ReadOnly label="Admin" value={me.isAdmin ? "Yes" : "No"} />
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Link
                to="/wallet"
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-sm"
              >
                Manage Wallet / PIN
              </Link>
              <Link
                to="/settings"
                className="rounded-lg border border-zinc-700 hover:bg-zinc-900 px-3 py-2 text-sm"
              >
                Account Settings
              </Link>
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
