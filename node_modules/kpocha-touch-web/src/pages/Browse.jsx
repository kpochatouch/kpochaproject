import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import BarberCard from '../components/BarberCard'

export default function Browse(){
  const [barbers, setBarbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [lga, setLga] = useState('')

  useEffect(()=>{
    const run = async()=>{
      try {
        const { data } = await api.get('/api/barbers', { params: { lga: lga || undefined } })
        setBarbers(data)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [lga])

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold">Browse Professionals</h2>
        <select value={lga} onChange={e=>setLga(e.target.value)} className="bg-black border border-zinc-800 rounded-lg px-3 py-2">
          <option value="">All LGAs</option>
          {["AKOKO-EDO","EGOR","ESAN CENTRAL","ESAN NORTH-EAST","ESAN SOUTH-EAST","ESAN WEST","ETSAKO CENTRAL","ETSAKO EAST","ETSAKO WEST","IGUEBEN","IKPOBA-OKHA","OREDO","ORHIONMWON","OVIA NORTH-EAST","OVIA SOUTH-WEST","OWAN EAST","OWAN WEST","Uhunmwonde","OTHERS"].map(x=>(<option key={x} value={x}>{x}</option>))}
        </select>
      </div>
      {loading ? <p className="text-zinc-400">Loading…</p> :
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {barbers.map(b => <BarberCard key={b.id} barber={b} />)}
        </div>
      }
    </div>
  )
}
