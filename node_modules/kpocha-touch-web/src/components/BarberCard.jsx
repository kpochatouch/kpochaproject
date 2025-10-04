import { Link } from 'react-router-dom'

export default function BarberCard({ barber }){
  return (
    <div className="border border-zinc-800 rounded-2xl p-4 hover:border-gold transition">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">{barber.name}</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${barber.availability==='Available'?'bg-green-900/40 text-green-300':'bg-zinc-800 text-zinc-300'}`}>
          {barber.availability}
        </span>
      </div>
      <p className="text-sm text-zinc-400 mb-3">{barber.lga} • ⭐ {barber.rating?.toFixed(1) || '5.0'}</p>
      <div className="flex gap-2 flex-wrap text-sm text-zinc-300 mb-4">
        {barber.services?.slice(0,3).map((s,i)=>(
          <span key={i} className="border border-zinc-800 rounded-full px-3 py-1">{s.name} ₦{s.price}</span>
        ))}
      </div>
      <Link to={`/book/${barber.id}`} className="inline-block rounded-lg bg-gold text-black px-4 py-2 font-medium">Book</Link>
    </div>
  )
}
