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
      } catch (e) {
        // no coords — that's okay, fallback to server LGA/state matching
        console.warn("[instant] geolocation failed:", e?.message || e);
      }
    }

    try {
      const res = await matchingClient.requestMatch({
        serviceName,
        lat: coords?.lat,
        lon: coords?.lon,
      });

      if (res.found && res.proId) {
        setProId(res.proId);
        setSearching(false);
        nav(`/book/${res.proId}`, { state: { serviceName, amountNaira } });
        return;
      }

      if (res.matchId) {
        setMatchId(res.matchId);
        // start polling
        startPolling(res.matchId);
      } else {
        setErr("No professionals are available right now.");
        setSearching(false);
      }
    } catch (e) {
      console.error(e);
      setErr("Could not start instant search.");
      setSearching(false);
    }
  }

  function startPolling(id) {
    // clear previous
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = setInterval(async () => {
      try {
        const s = await matchingClient.getStatus(id);
        // if server returns proId, navigate
        if (s && s.proId) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setProId(s.proId);
          setSearching(false);
          nav(`/book/${s.proId}`, { state: { serviceName, amountNaira } });
        }
      } catch (e) {
        // handle 404 explicitly (expired key)
        if (e?.response && e.response.status === 404) {
          // match expired — stop polling and tell user nothing found
          clearInterval(pollRef.current);
          pollRef.current = null;
          setSearching(false);
          setErr("No professionals were found nearby. Try again or adjust your search.");
        } else {
          console.error("poll error", e);
          // keep polling for transient errors
        }
      }
    }, 2000);
  }

  useEffect(() => {
    let mounted = true;
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
              <button onClick={() => { startSearch(); }} className="rounded-lg border border-zinc-700 px-3 py-2">Retry</button>
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
