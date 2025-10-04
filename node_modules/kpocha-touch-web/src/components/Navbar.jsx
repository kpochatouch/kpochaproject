import { Link, NavLink } from 'react-router-dom'

export default function Navbar(){
  return (
    <header className="border-b border-zinc-800 sticky top-0 z-40 bg-black/70 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Kpocha Touch" className="h-6 w-auto" />
          <span className="text-gold font-semibold hidden sm:inline">Connecting You To Top Barbers and Stylists</span>
        </Link>
        <nav className="flex items-center gap-4">
          <NavLink to="/browse" className="hover:text-gold">Browse</NavLink>
          <NavLink to="/wallet" className="hover:text-gold">Wallet</NavLink>
          <NavLink to="/profile" className="hover:text-gold">Profile</NavLink>
          <NavLink to="/login" className="rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black">Sign In</NavLink>
        </nav>
      </div>
    </header>
  )
}
