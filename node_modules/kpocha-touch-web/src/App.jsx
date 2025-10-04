import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Browse from './pages/Browse.jsx'
import BookService from './pages/BookService.jsx'
import Wallet from './pages/Wallet.jsx'
import Profile from './pages/Profile.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import BecomePro from './pages/BecomePro.jsx' // ✅ Added become professional page

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/book/:barberId" element={<BookService />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/become" element={<BecomePro />} /> {/* ✅ Route now active */}
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
