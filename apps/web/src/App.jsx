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
import { MeProvider, useMe } from "./context/MeContext.jsx";

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
const AwsLiveness = lazy(() => import("./pages/AwsLiveness.jsx")); // only AWS liveness

/* ---------- Chatbase (same as before) ---------- */
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
        // anonymous ok
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

/* ---------- role guards (reuse MeContext) ---------- */
function RequireRole({ role, children }) {
  const { loading, isAdmin, isPro } = useMe();
  const loc = useLocation();

  const allowed =
    role === "admin" ? isAdmin : role === "pro" ? isPro : true;

  if (loading) return <RouteLoader />;
  return allowed ? (
    children
  ) : (
    <Navigate to="/" replace state={{ from: loc }} />
  );
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

// choose browse vs register
function FindProSmart() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { loading, me } = useMe();

  useEffect(() => {
    let alive = true;
    (async () => {
      // not logged in -> go login
      if (!me && !loading) {
        navigate("/login", { replace: true, state: { from: loc } });
        return;
      }
      if (loading) return;

      // logged in -> check if client profile exists
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

  // prefetch very common routes once
  useEffect(() => {
    // don’t await — just fire
    import("./pages/Browse.jsx");
    import("./pages/Profile.jsx");
  }, []);

  const hideChrome = location.pathname.startsWith("/aws-liveness");

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      {!hideChrome && <Navbar />}

      <main className={hideChrome ? "flex-1 bg-black" : "flex-1"}>
        <MeProvider>
          <Suspense fallback={<RouteLoader full />}>
            <Routes>
              {/* public */}
              <Route path="/" element={<Home />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/find" element={<FindProSmart />} />
              <Route path="/book/:barberId" element={<BookService />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/legal" element={<Legal />} />
              <Route path="/legal/*" element={<Legal />} />

              {/* booking details require auth */}
              <Route
                path="/bookings/:id"
                element={
                  <RequireAuth>
                    <BookingDetails />
                  </RequireAuth>
                }
              />

              {/* profile */}
              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />

              {/* wallet */}
              <Route
                path="/wallet"
                element={
                  <RequireAuth>
                    <WalletSmart />
                  </RequireAuth>
                }
              />

              {/* settings */}
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <SettingsSmart />
                  </RequireAuth>
                }
              />

              {/* become */}
              <Route
                path="/become"
                element={
                  <RequireAuth>
                    <BecomePro />
                  </RequireAuth>
                }
              />

              {/* ONLY AWS LIVENESS */}
              <Route
                path="/aws-liveness"
                element={
                  <RequireAuth>
                    <AwsLiveness />
                  </RequireAuth>
                }
              />

              {/* client register */}
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

              {/* deactivate */}
              <Route
                path="/deactivate"
                element={
                  <RequireAuth>
                    <DeactivateAccount />
                  </RequireAuth>
                }
              />

              {/* pro dashboard */}
              <Route
                path="/pro-dashboard"
                element={
                  <RequireRole role="pro">
                    <ProDashboard />
                  </RequireRole>
                }
              />

              {/* admin */}
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

              {/* payments & misc */}
              <Route path="/apply/thanks" element={<ApplyThanks />} />
              <Route path="/payment/confirm" element={<PaymentConfirm />} />

              {/* fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </MeProvider>
      </main>

      {!hideChrome && <Footer />}
    </div>
  );
}
