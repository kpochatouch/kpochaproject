import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function BookService(){
  const { barberId } = useParams()
  const [barber, setBarber] = useState(null)
  const [dateTime, setDateTime] = useState('')

  useEffect(()=>{
    (async()=>{
      const { data } = await api.get('/api/barbers/' + barberId)
      setBarber(data)
    })()
  }, [barberId])

  async function checkout(){
    // Placeholder: initialize payment on backend
    const { data } = await api.post('/api/payments/initialize', {
      amount: barber?.services?.[0]?.price || 1000,
      referenceNote: 'Booking demo'
    })
    alert(data.message || 'Payment initialized (stub)')
  }

  if(!barber) return <div className="max-w-3xl mx-auto px-4 py-10">Loading…</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-2">Book {barber.name}</h2>
      <p className="text-zinc-300 mb-6">{barber.lga} • Availability: {barber.availability}</p>
      <label className="block mb-4">
        <span className="text-sm text-zinc-400">Preferred date & time</span>
        <input type="datetime-local" className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2" value={dateTime} onChange={e=>setDateTime(e.target.value)} />
      </label>
      <button onClick={checkout} className="rounded-lg bg-gold text-black px-4 py-2 font-semibold">Pay & Confirm</button>
    </div>
  )
}
