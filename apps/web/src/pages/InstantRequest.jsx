import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import matchingClient from "../lib/matchingClient";
import MatchProgress from "../components/MatchProgress";

export default function InstantRequest() {
  const nav = useNavigate();
  const loc = useLocation();
  const state = loc.state || {};
  const serviceName = state.serviceName || "Selected service";
  const amountNaira = state.amountNaira || 0;

  const [searching, setSearching] = useState(false);
  const [matchId, setMatchId] = useState(null);
  const [proId, setProId] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  const pollMetaRef = useRef({ startTs: 0, attempts: 0 });

  // Polling config: poll every 2s, stop after 120s (or override via env/const)
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_MS = Number(import.meta.env.VITE_MATCHER_POLL_MS || 120000); // 120s default

  async function startSearch() {
    setErr("");
    setSearching(true);
    setMatchId(null);
    setProId(null);

    // try to get user coords
    let coords = null;
    if (navigator.geolocation) {
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
        );
        coords = { lat: p.coords.latitude, lon: p.coords.longitude };
        console.log("[instant] geolocation:", coords);
      } catch (e) {
        // no coords — that's okay, fallback to server LGA/state matching
        console.warn("[instant] geolocation failed:", e?.message || e);
      }
    }

    try {
      console.log("[instant] requesting match (service)", serviceName, { coords });
      const res = await matchingClient.requestMatch({
        serviceName,
        lat: coords?.lat,
        lon: coords?.lon,
      });

      // immediate hit
      if (res && res.found && res.proId) {
        console.log("[instant] found immediate pro:", res.proId);
        setProId(res.proId);
        setSearching(false);
        nav(`/book/${res.proId}`, { state: { serviceName, amountNaira } });
        return;
      }

      // got a match id — start polling
      if (res && res.matchId) {
        console.log("[instant] created matchId:", res.matchId);
        setMatchId(res.matchId);
        pollMetaRef.current = { startTs: Date.now(), attempts: 0 };
        startPolling(res.matchId);
        return;
      }

      // no pros at all
      console.log("[instant] no professionals available (no matchId)");
      setErr("No professionals are available right now.");
      setSearching(false);
    } catch (e) {
      console.error("[instant] startSearch failed:", e);
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
    setErr("No professionals were found nearby. Try again or adjust your search.");
    if (matchIdArg) {
      setMatchId(matchIdArg);
      console.log("[instant] polling stopped — match expired or not found:", matchIdArg);
    }
  }

  function startPolling(id) {
    // clear previous if present
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = setInterval(async () => {
      pollMetaRef.current.attempts += 1;
      const elapsed = Date.now() - pollMetaRef.current.startTs;
      try {
        console.log("[instant] poll attempt", pollMetaRef.current.attempts, "for", id);
        const s = await matchingClient.getStatus(id);

        // defensive: s may be the axios response body or something else
        if (!s) {
          console.log("[instant] poll received empty body; continuing");
          // continue polling for transient empties
          return;
        }

        // server returns { status: "searching" } or { status: "found", proId }
        if (s.status === "searching" || !s.status) {
          // still searching — do nothing
          console.log("[instant] still searching for", id);
        } else if (s.status === "found" && s.proId) {
          console.log("[instant] pro found via poll:", s.proId);
          clearInterval(pollRef.current);
          pollRef.current = null;
          setProId(s.proId);
          setSearching(false);
          nav(`/book/${s.proId}`, { state: { serviceName, amountNaira } });
          return;
        } else {
          // unknown state — log and keep polling a bit
          console.warn("[instant] unexpected status payload:", s);
        }

        // stop if we have polled longer than MAX_POLL_MS
        if (elapsed > MAX_POLL_MS) {
          console.log("[instant] max poll time exceeded — stopping", { elapsed, MAX_POLL_MS });
          stopPollingAndShowNotFound(id);
        }
      } catch (e) {
        // if server returned 404, the match key expired → stop polling with "not found"
        if (e?.response && e.response.status === 404) {
          console.log("[instant] poll 404 — match expired:", id);
          stopPollingAndShowNotFound(id);
        } else {
          // transient error (network, 5xx) — log but keep polling up to timeout
          console.warn("[instant] poll error (transient) — will keep polling:", e?.message || e);
          // also stop if elapsed exceed max
          const elapsed = Date.now() - pollMetaRef.current.startTs;
          if (elapsed > MAX_POLL_MS) {
            console.log("[instant] max poll time exceeded (after error) — stopping", { elapsed, MAX_POLL_MS });
            stopPollingAndShowNotFound(id);
          }
        }
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    let mounted = true;
    // set start timestamp for polling meta
    pollMetaRef.current.startTs = Date.now();
    startSearch();

    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  if (err) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold mb-4">Instant Request</h1>
        <p className="text-zinc-400 mb-6">Searching for a professional for <strong>{serviceName}</strong></p>
        <div className="rounded-xl border border-zinc-800 p-6 bg-black/40">
          <div className="text-center">
            <div className="text-lg font-medium mb-2 text-red-400">Not found</div>
            <div className="text-sm text-zinc-400 mb-4">{err}</div>
            {matchId && <div className="text-xs text-zinc-500 mb-3">Search ID: {matchId}</div>}
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setErr(""); startSearch(); }} className="rounded-lg border border-zinc-700 px-3 py-2">Retry</button>
              <a href="/browse" className="rounded-lg border border-zinc-700 px-3 py-2">Browse Pros</a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Instant Request</h1>
      <p className="text-zinc-400 mb-6">Searching for a professional for <strong>{serviceName}</strong></p>
      <MatchProgress matchId={matchId} searching={searching} />
    </div>
  );
}
