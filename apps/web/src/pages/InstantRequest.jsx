import React, { useEffect, useState } from "react";
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

  useEffect(() => {
    let alive = true;
    async function start() {
      try {
        setErr("");
        setSearching(true);
        // try to get user coords
        let coords = null;
        if (navigator.geolocation) {
          try {
            const p = await new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
            );
            coords = { lat: p.coords.latitude, lon: p.coords.longitude };
          } catch {}
        }

        const res = await matchingClient.requestMatch({
          serviceName,
          lat: coords?.lat,
          lon: coords?.lon,
        });

        if (!alive) return;
        if (res.found && res.proId) {
          setProId(res.proId);
          // navigate to booking page prefilled (client continues booking)
          nav(`/book/${res.proId}`, { state: { serviceName, amountNaira } });
        } else if (res.matchId) {
          setMatchId(res.matchId);
          // start polling
          poll(res.matchId);
        } else {
          setErr("No professionals available right now.");
          setSearching(false);
        }
      } catch (e) {
        console.error(e);
        setErr("Could not start instant search.");
        setSearching(false);
      }
    }
    start();
    let pollTimer;
    function poll(id) {
      pollTimer = setInterval(async () => {
        try {
          const s = await matchingClient.getStatus(id);
          if (s.proId) {
            setProId(s.proId);
            clearInterval(pollTimer);
            nav(`/book/${s.proId}`, { state: { serviceName, amountNaira } });
          }
        } catch (e) {
          console.error("poll error", e);
        }
      }, 2000);
    }
    return () => { alive = false; };
  }, []);

  if (err) return <div className="max-w-3xl mx-auto p-6 text-red-400">{err}</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Instant Request</h1>
      <p className="text-zinc-400 mb-6">Searching for a professional for <strong>{serviceName}</strong></p>
      <MatchProgress matchId={matchId} searching={searching} />
    </div>
  );
}
