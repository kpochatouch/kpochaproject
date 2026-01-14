// apps/web/src/pages/InstantRequest.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import matchingClient from "../lib/matchingClient";
import { api } from "../lib/api";
import MatchProgress from "../components/MatchProgress";

export default function InstantRequest() {
  const nav = useNavigate();
  const loc = useLocation();
  const navState = loc.state || {};

  // MODE:
  // - "service": came from Browse with a specific service
  // - "wildcard": opened from Navbar / SideMenu (no specific service)
  const mode = navState.mode || (navState.serviceName ? "service" : "wildcard");

  const [searching, setSearching] = useState(false);
  const [matchId, setMatchId] = useState(null);
  const [proId, setProId] = useState(null);
  const [err, setErr] = useState("");
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(mode === "wildcard");

  const pollRef = useRef(null);
  const pollMetaRef = useRef({ startTs: 0, attempts: 0 });

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_MS = Number(import.meta.env.VITE_MATCHER_POLL_MS || 120000); // 120s default

  // For service mode: real service name; for wildcard we don't display service name
  const serviceName =
    mode === "service" ? navState.serviceName || "Selected service" : "";
  const amountNaira = navState.amountNaira || 0;

  // Optional region passed from Browse
  const regionState = (navState.stateName || "").toUpperCase();
  const regionLga = (navState.lga || "").toUpperCase();

  async function startSearch(loadedProfile = null) {
    setErr("");
    setSearching(true);
    setMatchId(null);
    setProId(null);

    // try to get user coords
    let coords = null;
    if ("geolocation" in navigator) {
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }),
        );
        coords = { lat: p.coords.latitude, lon: p.coords.longitude };
        console.log("[instant] geolocation:", coords);
      } catch (e) {
        console.warn("[instant] geolocation failed:", e?.message || e);
      }
    }

    // choose location: prefer explicit state/lga from navigation, then from profile
    const p = loadedProfile || profile || {};
    const profileState = String(
      p.state || p.identity?.state || "",
    ).toUpperCase();
    const profileLga = String(
      p.lga || p.identity?.lga || p.identity?.city || "",
    ).toUpperCase();

    const stateParam = regionState || profileState || undefined;
    const lgaParam = regionLga || profileLga || undefined;

    // In wildcard mode we MUST have at least some location info
    if (mode === "wildcard" && !coords && !stateParam && !lgaParam) {
      setSearching(false);
      setErr(
        "We couldn't determine your location. Please complete your profile with State and LGA, or enable location access.",
      );
      return;
    }

    try {
      const payload = {};

      // Service-mode: send serviceName to narrow down.
      // Wildcard-mode: DO NOT send serviceName → backend will treat it as "any service in this LGA/state".
      if (
        mode === "service" &&
        serviceName &&
        serviceName !== "Selected service"
      ) {
        payload.serviceName = serviceName;
      }

      if (coords?.lat != null) payload.lat = coords.lat;
      if (coords?.lon != null) payload.lon = coords.lon;
      if (stateParam) payload.state = stateParam;
      if (lgaParam) payload.lga = lgaParam;

      console.log("[instant] requesting match payload:", payload);
      const res = await matchingClient.requestMatch(payload);

      if (res && res.found && res.proId) {
        console.log("[instant] found immediate pro:", res.proId);
        setProId(res.proId);
        setSearching(false);
        nav(`/book/${res.proId}`, {
          state: { serviceName, amountNaira },
        });
        return;
      }

      if (res && res.matchId) {
        console.log("[instant] created matchId:", res.matchId);
        setMatchId(res.matchId);
        pollMetaRef.current = { startTs: Date.now(), attempts: 0 };
        startPolling(res.matchId);
        return;
      }

      console.log("[instant] no professionals available (no matchId)");
      setErr("No professionals are available right now.");
      setSearching(false);
    } catch (e) {
      console.error(
        "[instant] startSearch failed:",
        e?.response?.data || e?.message || e,
      );
      setErr("Could not start instant search.");
      setSearching(false);
    }
  }

  function stopPollingAndShowNotFound(matchIdArg) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSearching(false);
    setErr(
      "No professionals were found nearby. Try again or adjust your search.",
    );
    if (matchIdArg) {
      setMatchId(matchIdArg);
      console.log(
        "[instant] polling stopped — match expired or not found:",
        matchIdArg,
      );
    }
  }

  function startPolling(id) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = setInterval(async () => {
      pollMetaRef.current.attempts += 1;
      const elapsed = Date.now() - pollMetaRef.current.startTs;
      try {
        console.log(
          "[instant] poll attempt",
          pollMetaRef.current.attempts,
          "for",
          id,
        );
        const s = await matchingClient.getStatus(id);

        if (!s) {
          console.log("[instant] poll received empty body; continuing");
          return;
        }

        if (s.status === "searching" || !s.status) {
          console.log("[instant] still searching for", id);
        } else if (s.status === "found" && s.proId) {
          console.log("[instant] pro found via poll:", s.proId);
          clearInterval(pollRef.current);
          pollRef.current = null;
          setProId(s.proId);
          setSearching(false);
          nav(`/book/${s.proId}`, {
            state: { serviceName, amountNaira },
          });
          return;
        } else {
          console.warn("[instant] unexpected status payload:", s);
        }

        if (elapsed > MAX_POLL_MS) {
          console.log("[instant] max poll time exceeded — stopping", {
            elapsed,
            MAX_POLL_MS,
          });
          stopPollingAndShowNotFound(id);
        }
      } catch (e) {
        // 404: match expired → stop polling and show Not Found
        if (e?.response && e.response.status === 404) {
          console.log("[instant] poll 404 — match expired:", id);
          stopPollingAndShowNotFound(id);
        } else {
          console.warn(
            "[instant] poll error (transient) — will keep polling:",
            e?.message || e,
          );
          const elapsed = Date.now() - pollMetaRef.current.startTs;
          if (elapsed > MAX_POLL_MS) {
            console.log(
              "[instant] max poll time exceeded (after error) — stopping",
              { elapsed, MAX_POLL_MS },
            );
            stopPollingAndShowNotFound(id);
          }
        }
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    let alive = true;

    async function init() {
      pollMetaRef.current.startTs = Date.now();

      // Wildcard mode → load profile to get default state/LGA
      if (mode === "wildcard") {
        setLoadingProfile(true);
        try {
          const { data } = await api.get("/api/profile/me");
          if (!alive) return;
          setProfile(data || null);
          await startSearch(data || null);
        } catch (e) {
          if (!alive) return;
          console.warn(
            "[instant] profile load failed:",
            e?.response?.data || e?.message || e,
          );
          setErr(
            "Please complete your profile (state and LGA) before using Instant Request.",
          );
          setSearching(false);
        } finally {
          if (alive) setLoadingProfile(false);
        }
      } else {
        // service mode → just start search using passed-in service/location
        await startSearch();
      }
    }

    init();

    return () => {
      alive = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heading = "Instant Request";

  const description =
    mode === "service" ? (
      <>
        Searching for a professional for <strong>{serviceName}</strong>
      </>
    ) : (
      <>Searching for a nearby professional</>
    );

  if (err) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-4">{heading}</h1>
        <p className="text-zinc-400 mb-6">{description}</p>
        <div className="rounded-xl border border-zinc-800 p-6 bg-black/40">
          <div className="text-center">
            <div className="text-lg font-medium mb-2 text-red-400">
              Not found
            </div>
            <div className="text-sm text-zinc-400 mb-4">{err}</div>
            {matchId && (
              <div className="text-xs text-zinc-500 mb-3">
                Search ID: {matchId}
              </div>
            )}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  setErr("");
                  // In wildcard mode, we may need profile again; but if it's already loaded, reuse it
                  startSearch(profile);
                }}
                className="rounded-lg border border-zinc-700 px-3 py-2"
              >
                Retry
              </button>
              <a
                href="/browse"
                className="rounded-lg border border-zinc-700 px-3 py-2"
              >
                Browse Pros
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Optionally show a tiny loading message while fetching profile in wildcard mode
  if (loadingProfile && mode === "wildcard") {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-4">{heading}</h1>
        <p className="text-zinc-400 mb-6">
          Preparing your instant request (loading your location)…
        </p>
        <MatchProgress matchId={matchId} searching={true} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">{heading}</h1>
      <p className="text-zinc-400 mb-6">{description}</p>
      <MatchProgress matchId={matchId} searching={searching} />
    </div>
  );
}
