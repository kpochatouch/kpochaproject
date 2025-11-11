// apps/web/src/App.jsx
import React, { Suspense, lazy, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api } from "./lib/api";

import Navbar from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import RouteLoader from "./components/RouteLoader.jsx";
import { useMe } from "./context/MeContext.jsx";

// ---------- pages (lazy) ----------
const Home = lazy(() => import("./pages/Home.jsx"));
const Browse = lazy(() => import("./pages/Browse.jsx"));
const BookService = lazy(() => import("./pages/BookService.jsx"));
const BookingDetails = lazy(() => import("./pages/BookingDetails.jsx"));
const Wallet = lazy(() => import("./pages/Wallet.jsx"));
const ClientWallet = lazy(() => import("./pages/ClientWallet.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Signup = lazy(() => import("./pages/Signup.jsx"));
const BecomePro = lazy(() => import("./pages/BecomePro.jsx"));
const ProDashboard = lazy(() => import("./pages/ProDashboard.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const ClientSettings = lazy(() => import("./pages/ClientSettings.jsx"));
const AdminDecline = lazy(() => import("./pages/AdminDecline.jsx"));
const Legal = lazy(() => import("./pages/Legal.jsx"));
const ClientRegister = lazy(() => import("./pages/ClientRegister.jsx"));
const DeactivateAccount = lazy(() => import("./pages/DeactivateAccount.jsx"));
const ApplyThanks = lazy(() => import("./pages/ApplyThanks.jsx"));
const PaymentConfirm = lazy(() => import("./pages/PaymentConfirm.jsx"));
const AwsLiveness = lazy(() => import("./pages/AwsLiveness.jsx"));
const RiskLogs = lazy(() => import("./pages/RiskLogs.jsx"));
const Chat = lazy(() => import("./pages/Chat.jsx"));
const Compose = lazy(() => import("./pages/Compose.jsx"));

// public profile
const PublicProfile = lazy(() => import("./pages/PublicProfile.jsx"));

/* ---------- Chatbase hook ---------- */
function useChatbase() {
  useEffect(() => {
    const CHATBOT_ID = import.meta.env.VITE_CHATBASE_ID;
    if (!CHATBOT_ID) return;

    (async () => {
      const cfg = { chatbotId: CHATBOT_ID };

      try {
        const r = await api.get("/api/chatbase/userhash");
        if (r?.data?.userId && r?.data?.userHash) {
          cfg.userId = r.data.userId;
          cfg.userHash = r.data.userHash;
        }
      } catch {
        /* ignore */
      }

      window.chatbaseConfig = cfg;

      if (!document.getElementById(CHATBOT_ID)) {
        const s = document.createElement("script");
        s.src = "https://www.chatbase.co/embed.min.js";
        s.id = CHATBOT_ID;
        s.defer = true;
        s.dataset.domain = "www.chatbase.co";
        document.body.appendChild(s);
      }
    })();
  }, []);
}

/* ---------- role guards ---------- */
function RequireRole({ role, children }) {
  const { loading, isAdmin, isPro } = useMe();
  const loc = useLocation();

  const allowed =
    role === "admin" ? isAdmin : role === "pro" ? isPro : true;

  if (loading) return <RouteLoader />;
  return allowed ? children : <Navigate to="/" replace state={{ from: loc }} />;
}

function WalletSmart() {
  const { loading, isPro } = useMe();
  if (loading) return <RouteLoader />;
  return isPro ? <Wallet /> : <ClientWallet />;
}

function SettingsSmart() {
  const { loading, isPro } = useMe();
  if (loading) return <RouteLoader />;
  return isPro ? <Settings /> : <ClientSettings />;
}

function FindProSmart() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { loading, me } = useMe();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me && !loading) {
        navigate("/login", { replace: true, state: { from: loc } });
        return;
      }
      if (loading) return;

      try {
        const { data } = await api.get("/api/profile/client/me");
        if (!alive) return;
        if (!data) {
          navigate("/client/register", { replace: true });
        } else {
          navigate("/browse", { replace: true });
        }
      } catch {
        navigate("/client/register", { replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, me, navigate, loc]);

  return <RouteLoader />;
}

/* ---------- App ---------- */
export default function App() {
  useChatbase();
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ this is the listener you need
  useEffect(() => {
    function onAwsLivenessStart(e) {
      const sessionId =
        e?.detail?.sessionId ||
        e?.detail?.SessionId ||
        e?.detail?.sessionID ||
        "";
      const back = e?.detail?.back || "/settings";

      if (sessionId) {
        try {
          localStorage.setItem("kpocha:awsLivenessSession", sessionId);
        } catch {}
      }

      navigate(`/aws-liveness?back=${encodeURIComponent(back)}`);
    }

    window.addEventListener("aws-liveness:start", onAwsLivenessStart);
    return () => {
      window.removeEventListener("aws-liveness:start", onAwsLivenessStart);
    };
  }, [navigate]);

  // prefetch common routes
  useEffect(() => {
    import("./pages/Browse.jsx");
    import("./pages/Profile.jsx");
    import("./pages/PublicProfile.jsx");
  }, []);

  const hideChrome = location.pathname.startsWith("/aws-liveness");

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      {!hideChrome && <Navbar />}

      <main className={hideChrome ? "flex-1 bg-black" : "flex-1"}>
        <Suspense fallback={<RouteLoader full />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route
              path="/compose"
              element={
                <RequireAuth>
                  <Compose />
                </RequireAuth>
              }
            />
            <Route path="/find" element={<FindProSmart />} />
            <Route path="/book/:barberId" element={<BookService />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/legal/*" element={<Legal />} />
            <Route path="/profile/:id" element={<PublicProfile />} />
            <Route
              path="/bookings/:id"
              element={
                <RequireAuth>
                  <BookingDetails />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <Profile />
                </RequireAuth>
              }
            />
            <Route
              path="/wallet"
              element={
                <RequireAuth>
                  <WalletSmart />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsSmart />
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
            <Route
              path="/aws-liveness"
              element={
                <RequireAuth>
                  <AwsLiveness />
                </RequireAuth>
              }
            />
            <Route
              path="/client/register"
              element={
                <RequireAuth>
                  <ClientRegister />
                </RequireAuth>
              }
            />
            <Route
              path="/register"
              element={<Navigate to="/client/register" replace />}
            />
            <Route
              path="/deactivate"
              element={
                <RequireAuth>
                  <DeactivateAccount />
                </RequireAuth>
              }
            />
            <Route
              path="/pro-dashboard"
              element={
                <RequireRole role="pro">
                  <ProDashboard />
                </RequireRole>
              }
            />
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
            <Route
              path="/risk-logs"
              element={
                <RequireRole role="admin">
                  <RiskLogs />
                </RequireRole>
              }
            />
            <Route
              path="/chat"
              element={
                <RequireAuth>
                  <Chat />
                </RequireAuth>
              }
            />
            <Route path="/apply/thanks" element={<ApplyThanks />} />
            <Route path="/payment/confirm" element={<PaymentConfirm />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {!hideChrome && <Footer />}
    </div>
  );
}
