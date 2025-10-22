// apps/web/src/pages/BecomePro.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";
import SmartUpload from "../components/SmartUpload.jsx";

/* ---------- Services ---------- */
const SERVICE_OPTIONS = [
  "Barbering",
  "Hair Styling (female)",
  "Wig installation",
  "Dreadlock / Locs",
  "Pedicure",
  "Manicure",
  "Nails (extensions/maintenance)",
  "Makeup",
  "Skincare / Facial",
  "Others",
];

/* ---------- Unified dark field style ---------- */
const FIELD =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30";

export default function BecomePro() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // --------- Sections state ---------
  const [identity, setIdentity] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gender: "",
    dob: "",
    phone: "",
    whatsapp: "",
    email: "",
    state: "",
    lga: "",
    originState: "",
    photoUrl: "",
  });
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

  const [professional, setProfessional] = useState({
    services: [],
    years: "",
    workPhotos: [""],
    hasCert: "no",
    certUrl: "",
    profileVisible: true,
    nationwide: false,
  });

  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",
    shopPhotoOutside: "",
    shopPhotoInside: "",
  });

  const [availability, setAvailability] = useState({
    days: { Mon:false, Tue:false, Wed:false, Thu:false, Fri:false, Sat:false, Sun:false },
    start: "",
    end: "",
    emergency: "no",
    homeService: "no",
    homeServicePrice: "",
    statesCovered: [],
  });

  const [pricing, setPricing] = useState({
    menCut: "",
    womenCut: "",
    locs: "",
    manicure: "",
    pedicure: "",
    otherServices: "",
  });

  const [verification, setVerification] = useState({
    idType: "",
    idUrl: "",
    selfieWithIdUrl: "",
  });

  const [bank, setBank] = useState({
    bankName: "",
    accountName: "",
    accountNumber: "",
    bvn: "",
  });

  const [portfolio, setPortfolio] = useState({
    instagram: "",
    tiktok: "",
    facebook: "",
    website: "",
    testimonials: "",
  });

  // ✅ Two checkboxes
  const [agreements, setAgreements] = useState({
    terms: false,
    privacy: false,
  });

  // Prefill email from /api/me
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        setIdentity((p) => ({ ...p, email: data?.email || p.email }));
      } catch {}
    })();
  }, []);

  // Pull states list (soft — no error banner)
  const [allStates, setAllStates] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!alive) return;
        setAllStates(Array.isArray(data?.states) ? data.states : []);
      } catch {
        if (alive) setAllStates([]);
      }
    })();
    return () => { alive = false; };
  }, []);
  const stateList = useMemo(() => (allStates || []).slice().sort(), [allStates]);

  // ✅ Required fields + agreements
  const canSubmit =
    identity.firstName &&
    identity.lastName &&
    identity.gender &&
    identity.dob &&
    identity.phone &&
    identity.state &&
    (professional.nationwide || identity.lga) &&
    identity.photoUrl &&
    professional.services.length > 0 &&
    verification.idType &&
    verification.idUrl &&
    verification.selfieWithIdUrl &&
    bank.bankName &&
    bank.accountName &&
    bank.accountNumber &&
    bank.bvn &&
    agreements.terms &&
    agreements.privacy;

  function digitsOnly(s = "") {
    return String(s).replace(/\D/g, "");
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setMsg("");
    try {
      const payload = {
        identity,
        professional,
        business,
        availability: {
          ...availability,
          statesCovered: professional.nationwide ? stateList : availability.statesCovered,
        },
        pricing,
        verification: {
          ...verification,
          ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
        },
        bank: {
          ...bank,
          accountNumber: digitsOnly(bank.accountNumber).slice(0, 10),
          bvn: digitsOnly(bank.bvn).slice(0, 11),
        },
        portfolio,
        ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
        status: "submitted",
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: { terms: !!agreements.terms, privacy: !!agreements.privacy },
      };

      await api.put("/api/pros/me", payload);
      nav("/apply/thanks");
    } catch (err) {
      console.error(err);
      setMsg("Failed to submit application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">Professional Application</h2>
      {msg && <div className="mb-4 text-sm text-red-400">{msg}</div>}

      <form onSubmit={submit} className="space-y-8">
        {/* SECTION 1: Identity & Contact */}
        <Section title="Identity & Contact" id="identity">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="First Name" value={identity.firstName} onChange={(e)=>setIdentity({...identity, firstName: e.target.value})} required />
            <Input label="Middle Name" value={identity.middleName} onChange={(e)=>setIdentity({...identity, middleName: e.target.value})} />
            <Input label="Last Name" value={identity.lastName} onChange={(e)=>setIdentity({...identity, lastName: e.target.value})} required />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select label="Gender" value={identity.gender} onChange={(e)=>setIdentity({...identity, gender: e.target.value})}
              options={["Male","Female","Other"]} required />
            <Input label="Date of Birth" type="date" value={identity.dob} onChange={(e)=>setIdentity({...identity, dob: e.target.value})} required />
            <Input label="Email" type="email" value={identity.email} onChange={(e)=>setIdentity({...identity, email: e.target.value})} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <Label>Phone Number</Label>
              <input
                className={FIELD}
                value={identity.phone}
                onChange={(e)=>{ setIdentity({...identity, phone: e.target.value}); setPhoneVerifiedAt(null); }}
                required
                placeholder="080..."
              />
              <PhoneOTP phone={identity.phone} disabled={!identity.phone} onVerified={(iso)=>setPhoneVerifiedAt(iso)} />
              {phoneVerifiedAt && <div className="text-xs text-emerald-300 mt-1">Verified</div>}
            </div>
            <Input label="WhatsApp (optional)" value={identity.whatsapp} onChange={(e)=>setIdentity({...identity, whatsapp: e.target.value})} />
            <div>
              <Label>Profile Photo</Label>
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  placeholder="Photo URL"
                  value={identity.photoUrl}
                  onChange={(e)=>setIdentity({...identity, photoUrl: e.target.value})}
                />
                <SmartUpload
                  title="Upload"
                  camera="user"
                  folder="kpocha/pro-apps"
                  onUploaded={(url)=>setIdentity({...identity, photoUrl: url})}
                />
              </div>
            </div>
          </div>

          {/* State/LGA via dynamic picker */}
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={professional.nationwide}
                onChange={(e)=>setProfessional({...professional, nationwide: e.target.checked})}
              />
              Offer services nationwide (Nigeria)
            </label>

            <NgGeoPicker
              valueState={identity.state}
              onChangeState={(st) => {
                setIdentity({ ...identity, state: st, lga: "" });
                if (st && !professional.nationwide) {
                  setAvailability((p)=>({
                    ...p,
                    statesCovered: p.statesCovered.includes(st) ? p.statesCovered : [...p.statesCovered, st]
                  }));
                }
              }}
              valueLga={identity.lga}
              onChangeLga={(l) => setIdentity({ ...identity, lga: l })}
              required
              className="grid grid-cols-1 gap-3"
            />

            {!professional.nationwide && (
              <div className="text-sm">
                <Label>States you cover</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-auto p-2 border border-zinc-800 rounded">
                  {stateList.map((st) => (
                    <label key={st} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={availability.statesCovered.includes(st)}
                        onChange={()=>setAvailability((p)=>({
                          ...p,
                          statesCovered: p.statesCovered.includes(st)
                            ? p.statesCovered.filter((x)=>x!==st)
                            : [...p.statesCovered, st],
                        }))}
                      />
                      {st}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* SECTION 2: Professional Details */}
        <Section title="Professional Details" id="professional">
          <div className="flex items-center justify-between mb-2">
            <Label>What service do you offer?</Label>
            <label className="text-xs flex items-center gap-2">
              <input
                type="checkbox"
                checked={professional.profileVisible}
                onChange={(e)=>setProfessional({...professional, profileVisible: e.target.checked})}
              />
              Profile visible in search
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SERVICE_OPTIONS.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={professional.services.includes(opt)}
                  onChange={() =>
                    setProfessional((p) => {
                      const has = p.services.includes(opt);
                      return { ...p, services: has ? p.services.filter(s => s!==opt) : [...p.services, opt] };
                    })
                  }
                />
                {opt}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select
              label="Years of Experience"
              value={professional.years}
              onChange={(e)=>setProfessional({...professional, years: e.target.value})}
              options={["0–1 year","2–4 years","5–10 years","10+ years"]}
            />
            <Select
              label="Any certification?"
              value={professional.hasCert}
              onChange={(e)=>setProfessional({...professional, hasCert: e.target.value})}
              options={["no","yes"]}
            />
            {professional.hasCert === "yes" && (
              <div>
                <Label>Certificate</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="Certificate URL"
                    value={professional.certUrl}
                    onChange={(e)=>setProfessional({...professional, certUrl: e.target.value})}
                  />
                  <SmartUpload
                    title="Upload"
                    camera="user"
                    folder="kpocha/pro-apps"
                    onUploaded={(url)=>setProfessional({...professional, certUrl: url})}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3">
            <Label>Work Photos</Label>
            {professional.workPhotos.map((u, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <input
                  className={FIELD}
                  placeholder={`Photo URL ${idx+1}`}
                  value={u}
                  onChange={(e)=>{
                    const arr=[...professional.workPhotos]; arr[idx]=e.target.value;
                    setProfessional({...professional, workPhotos: arr});
                  }}
                />
                <SmartUpload
                  title="Upload"
                  camera="environment"
                  folder="kpocha/pro-apps"
                  onUploaded={(url)=>{
                    const arr=[...professional.workPhotos]; arr[idx]=url;
                    setProfessional({...professional, workPhotos: arr});
                  }}
                />
                {idx>0 && (
                  <button
                    type="button"
                    className="text-sm text-red-400"
                    onClick={()=> setProfessional({...professional, workPhotos: professional.workPhotos.filter((_,i)=>i!==idx)})}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="text-sm text-gold underline"
              onClick={()=>setProfessional({...professional, workPhotos:[...professional.workPhotos, ""]})}>
              + Add another
            </button>
          </div>
        </Section>

        {/* SECTION 3: Business */}
        <Section title="Business Information" id="business">
          <Select
            label="Work Mode"
            value={business.mode}
            onChange={(e)=>setBusiness({...business, mode: e.target.value})}
            options={["shop","home","both"]}
          />
          {(business.mode === "shop" || business.mode === "both") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Input label="Business / Shop Name" value={business.shopName} onChange={(e)=>setBusiness({...business, shopName: e.target.value})} />
              <Input label="Business Address" value={business.shopAddress} onChange={(e)=>setBusiness({...business, shopAddress: e.target.value})} />
              <div>
                <Label>Photo (outside)</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoOutside}
                    onChange={(e)=>setBusiness({...business, shopPhotoOutside: e.target.value})}
                  />
                  <SmartUpload
                    title="Upload"
                    camera="environment"
                    folder="kpocha/pro-apps"
                    onUploaded={(url)=>setBusiness({...business, shopPhotoOutside: url})}
                  />
                </div>
              </div>
              <div>
                <Label>Photo (inside)</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoInside}
                    onChange={(e)=>setBusiness({...business, shopPhotoInside: e.target.value})}
                  />
                  <SmartUpload
                    title="Upload"
                    camera="environment"
                    folder="kpocha/pro-apps"
                    onUploaded={(url)=>setBusiness({...business, shopPhotoInside: url})}
                  />
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* SECTION 4: Availability */}
        <Section title="Work Availability" id="availability">
          <Label>Working Days</Label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-sm">
            {Object.keys(availability.days).map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input type="checkbox" checked={availability.days[d]} onChange={()=>
                  setAvailability((p)=>({ ...p, days: { ...p.days, [d]: !p.days[d] } }))
                } />
                {d}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Input label="Start time" type="time" value={availability.start} onChange={(e)=>setAvailability({...availability, start: e.target.value})} />
            <Input label="End time" type="time" value={availability.end} onChange={(e)=>setAvailability({...availability, end: e.target.value})} />
            <Select label="Emergency service?" value={availability.emergency} onChange={(e)=>setAvailability({...availability, emergency:e.target.value})} options={["no","yes"]} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select label="Home service?" value={availability.homeService} onChange={(e)=>setAvailability({...availability, homeService:e.target.value})} options={["no","yes"]} />
            {availability.homeService === "yes" && (
              <Input label="Home service starting price (₦)" value={availability.homeServicePrice} onChange={(e)=>setAvailability({...availability, homeServicePrice: e.target.value})}/>
            )}
          </div>
        </Section>

        {/* SECTION 5: Pricing (optional) */}
        <Section title="Pricing (optional)" id="pricing">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Men’s Cut (₦)" value={pricing.menCut} onChange={(e)=>setPricing({...pricing, menCut: e.target.value})}/>
            <Input label="Women’s Cut (₦)" value={pricing.womenCut} onChange={(e)=>setPricing({...pricing, womenCut: e.target.value})}/>
            <Input label="Dreadlock (₦)" value={pricing.locs} onChange={(e)=>setPricing({...pricing, locs: e.target.value})}/>
            <Input label="Manicure (₦)" value={pricing.manicure} onChange={(e)=>setPricing({...pricing, manicure: e.target.value})}/>
            <Input label="Pedicure (₦)" value={pricing.pedicure} onChange={(e)=>setPricing({...pricing, pedicure: e.target.value})}/>
          </div>
          <textarea
            className={`${FIELD} mt-3`}
            placeholder="Other services & prices"
            value={pricing.otherServices}
            onChange={(e)=>setPricing({...pricing, otherServices: e.target.value})}
            rows={4}
          />
        </Section>

        {/* SECTION 6: Identity Verification */}
        <Section title="Identity Verification" id="verification">
          <Select label="ID Type" value={verification.idType} onChange={(e)=>setVerification({...verification, idType: e.target.value})}
            options={["National ID","Voter’s Card","Driver’s License","International Passport"]} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <Label>Government ID</Label>
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  placeholder="ID Image URL"
                  value={verification.idUrl}
                  onChange={(e)=>setVerification({...verification, idUrl: e.target.value})}
                />
                <SmartUpload
                  title="Upload"
                  camera="environment"
                  folder="kpocha/pro-apps"
                  onUploaded={(url)=>setVerification({...verification, idUrl: url})}
                />
              </div>
            </div>
            <div>
              <Label>Selfie holding ID</Label>
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  placeholder="Selfie Image URL"
                  value={verification.selfieWithIdUrl}
                  onChange={(e)=>setVerification({...verification, selfieWithIdUrl: e.target.value})}
                />
                <SmartUpload
                  title="Upload"
                  camera="user"
                  folder="kpocha/pro-apps"
                  onUploaded={(url)=>setVerification({...verification, selfieWithIdUrl: url})}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* SECTION 7: Bank Details */}
        <Section title="Bank Details" id="bank">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Bank Name" value={bank.bankName} onChange={(e)=>setBank({...bank, bankName: e.target.value})} required />
            <Input label="Account Name" value={bank.accountName} onChange={(e)=>setBank({...bank, accountName: e.target.value})} required />
            <Input
              label="Account Number"
              value={bank.accountNumber}
              onChange={(e)=>setBank({...bank, accountNumber: digitsOnly(e.target.value).slice(0,10)})}
              required
            />
            <Input
              label="BVN (required)"
              value={bank.bvn}
              onChange={(e)=>setBank({...bank, bvn: digitsOnly(e.target.value).slice(0,11)})}
              required
            />
          </div>
        </Section>

        {/* SECTION 8: Social / Portfolio */}
        <Section title="Social Proof / Portfolio" id="portfolio">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Instagram" value={portfolio.instagram} onChange={(e)=>setPortfolio({...portfolio, instagram: e.target.value})} />
            <Input label="TikTok" value={portfolio.tiktok} onChange={(e)=>setPortfolio({...portfolio, tiktok: e.target.value})} />
            <Input label="Facebook" value={portfolio.facebook} onChange={(e)=>setPortfolio({...portfolio, facebook: e.target.value})} />
            <Input label="Website / Portfolio" value={portfolio.website} onChange={(e)=>setPortfolio({...portfolio, website: e.target.value})} />
          </div>
          <textarea
            className={`${FIELD} mt-3`}
            placeholder="Testimonials / Reviews"
            value={portfolio.testimonials}
            onChange={(e)=>setPortfolio({...portfolio, testimonials: e.target.value})}
            rows={4}
          />
        </Section>

        {/* SECTION 9: Agreements */}
        <Section title="User Agreements" id="agreements">
          <div className="space-y-2 text-sm">
            <Check
              label={<>I have read and agree to the <a className="text-gold underline" href="/legal#terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a></>}
              checked={agreements.terms}
              onChange={()=>setAgreements({...agreements, terms: !agreements.terms})}
            />
            <Check
              label={<>I have read and agree to the <a className="text-gold underline" href="/legal#privacy" target="_blank" rel="noreferrer">Privacy Policy</a></>}
              checked={agreements.privacy}
              onChange={()=>setAgreements({...agreements, privacy: !agreements.privacy})}
            />
          </div>
        </Section>

        {/* FINAL STEP */}
        <button
          disabled={!canSubmit || busy}
          className="w-full bg-gold text-black font-semibold rounded-lg py-2 disabled:opacity-60"
        >
          {busy ? "Submitting..." : "Submit Application"}
        </button>
      </form>
    </div>
  );
}

/* ---------- UI bits ---------- */
function Section({ title, id, children }) {
  return (
    <section id={id} className="rounded-lg border border-zinc-800 p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}
function Label({ children }) { return <div className="text-sm text-zinc-300 mb-1">{children}</div>; }
function Input({ label, required, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <input {...props} className={FIELD} />
    </label>
  );
}
function Select({ label, options=[], required, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <select {...props} className={FIELD}>
        <option value="">{required ? "Select…" : "Select (optional)…"}</option>
        {options.map((o)=> <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Check({ label, ...props }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
