// apps/web/src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./lib/api";

// Pages
import Home from "./pages/Home.jsx";
import Browse from "./pages/Browse.jsx";
import BookService from "./pages/BookService.jsx";
import BookingDetails from "./pages/BookingDetails.jsx";
import Wallet from "./pages/Wallet.jsx";
import ClientWallet from "./pages/ClientWallet.jsx";
import Profile from "./pages/Profile.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import BecomePro from "./pages/BecomePro.jsx";
import ProDashboard from "./pages/ProDashboard.jsx";
import Admin from "./pages/Admin.jsx";
import Settings from "./pages/Settings.jsx";             // Pro settings
import ClientSettings from "./pages/ClientSettings.jsx"; // Client settings
import AdminDecline from "./pages/AdminDecline.jsx";
import Legal from "./pages/Legal.jsx";
import ClientRegister from "./pages/ClientRegister.jsx";
import DeactivateAccount from "./pages/DeactivateAccount.jsx";
import ApplyThanks from "./pages/ApplyThanks.jsx";
import PaymentConfirm from "./pages/PaymentConfirm.jsx"; // payment confirmation page

// Layout
import Navbar from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import RequireAuth from "./components/RequireAuth.jsx";

/* ---------- Chatbase loader (verified users when logged in) ---------- */
function useChatbase() {
  useEffect(() => {
    const CHATBOT_ID = import.meta.env.VITE_CHATBASE_ID; // e.g. 5gZgvHpeJvGhp8cWAlEvZ
    if (!CHATBOT_ID) return;

    async function init() {
      // Base config (anonymous)
      const cfg = { chatbotId: CHATBOT_ID };

      // Try verified mode if user is logged in
      try {
        const r = await api.get("/api/chatbase/userhash");
        if (r?.data?.userId && r?.data?.userHash) {
          cfg.userId = r.data.userId;
          cfg.userHash = r.data.userHash;
        }
      } catch {
        // Not logged in or endpoint unavailable → anonymous
      }

      // Make config available before loading script
      window.chatbaseConfig = cfg;

      // Load once; Chatbase expects script id = bot id and domain = "www.chatbase.co"
      if (!document.getElementById(CHATBOT_ID)) {
        const s = document.createElement("script");
        s.src = "https://www.chatbase.co/embed.min.js";
        s.id = CHATBOT_ID;            // important
        s.domain = "www.chatbase.co"; // important
        s.defer = true;
        document.body.appendChild(s);
      }
    }

    init();
  }, []);
}

/* ---------- Role guard ---------- */
function RequireRole({ role, children }) {
  const [ok, setOk] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        const allowed =
          role === "admin" ? !!data?.isAdmin :
          role === "pro"   ? !!data?.isPro   :
          !!data;
        if (alive) setOk(allowed);
      } catch {
        if (alive) setOk(false);
      }
    })();
    return () => { alive = false; };
  }, [role]);

  if (ok === null) return <div className="p-6">Loading…</div>;
  return ok ? children : <Navigate to="/" replace />;
}

/* ---------- Smart Wallet ---------- */
function WalletSmart() {
  const [state, setState] = useState({ loading: true, isPro: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;
        setState({ loading: false, isPro: !!data?.isPro });
      } catch {
        if (alive) setState({ loading: false, isPro: false });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state.loading) return <div className="p-6">Loading…</div>;
  return state.isPro ? <Wallet /> : <ClientWallet />;
}

/* ---------- Smart Settings (client vs pro) ---------- */
function SettingsSmart() {
  const [state, setState] = useState({ loading: true, isPro: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;
        setState({ loading: false, isPro: !!data?.isPro });
      } catch {
        if (alive) setState({ loading: false, isPro: false });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state.loading) return <div className="p-6">Loading…</div>;
  return state.isPro ? <Settings /> : <ClientSettings />;
}

export default function App() {
  useChatbase(); // initialize Chatbase

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Navbar />
      <main className="flex-1">
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/book/:barberId" element={<BookService />} />
          <Route path="/bookings/:id" element={<BookingDetails />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/*" element={<Legal />} />
          <Route path="/apply/thanks" element={<ApplyThanks />} />
          <Route path="/payment/confirm" element={<PaymentConfirm />} />

          {/* Helpful legal shortcuts */}
          <Route path="/terms" element={<Navigate to="/legal#terms" replace />} />
          <Route path="/privacy" element={<Navigate to="/legal#privacy" replace />} />
          <Route path="/cookies" element={<Navigate to="/legal#cookies" replace />} />
          <Route path="/refunds" element={<Navigate to="/legal#refunds" replace />} />

          {/* Auth-required */}
          <Route
            path="/wallet"
            element={
              <RequireAuth>
                <WalletSmart />
              </RequireAuth>
            }
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsSmart />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/pro"
            element={
              <RequireRole role="pro">
                <Settings />
              </RequireRole>
            }
          />
          <Route
            path="/settings/client"
            element={
              <RequireAuth>
                <ClientSettings />
              </RequireAuth>
            }
          />

          <Route
            path="/become"
            element={
              <RequireAuth>
                <BecomePro />
              </RequireAuth>
            }
          />

          {/* Client registration */}
          <Route
            path="/client-register"
            element={
              <RequireAuth>
                <ClientRegister />
              </RequireAuth>
            }
          />
          <Route path="/register" element={<Navigate to="/client-register" replace />} />

          {/* Account deactivation */}
          <Route
            path="/deactivate"
            element={
              <RequireAuth>
                <DeactivateAccount />
              </RequireAuth>
            }
          />

          {/* Pro Dashboard */}
          <Route
            path="/pro-dashboard"
            element={
              <RequireRole role="pro">
                <ProDashboard />
              </RequireRole>
            }
          />
          <Route path="/pro" element={<Navigate to="/pro-dashboard" replace />} />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                <Admin />
              </RequireRole>
            }
          />
          <Route
            path="/admin/decline/:id"
            element={
              <RequireRole role="admin">
                <AdminDecline />
              </RequireRole>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
