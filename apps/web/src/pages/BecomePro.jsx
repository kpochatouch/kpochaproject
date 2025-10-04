import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function BecomePro(){
  const { user } = useAuth();
  const [name, setName] = useState(user?.displayName || "");
  const [lga, setLga] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e){
    e.preventDefault();
    if(!user){ setMsg("Please sign in first."); return; }
    setBusy(true); setMsg("");
    try{
      const token = window.__ID_TOKEN__;
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pros/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ displayName: name, lga, phone, services: "" })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || "Failed to submit");
      setMsg("Application submitted! We’ll review and get back to you.");
    }catch(err){
      setMsg(err.message);
    }finally{
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-4">Become a Professional</h2>
      {msg && <div className="mb-3 text-sm text-gold">{msg}</div>}
      <form className="space-y-4" onSubmit={submit}>
        <input className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
               placeholder="Business / Display name"
               value={name} onChange={e=>setName(e.target.value)} />
        <input className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
               placeholder="LGA (e.g. Oredo)" value={lga}
               onChange={e=>setLga(e.target.value)} />
        <input className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
               placeholder="Phone / WhatsApp" value={phone}
               onChange={e=>setPhone(e.target.value)} />
        <button disabled={busy}
                className="rounded-lg bg-gold text-black px-4 py-2 font-semibold">
          {busy ? "Submitting..." : "Submit application"}
        </button>
      </form>
    </div>
  );
}
