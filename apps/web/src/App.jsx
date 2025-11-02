// apps/web/src/App.jsx
import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  createContext,
  useContext,
} from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api, setAuthToken } from "./lib/api";

// 🔐 Firebase → API header sync
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "./lib/firebase";

/* ---------- Layout & guards ---------- */
import Navbar from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import RequireAuth from "./components/RequireAuth.jsx";

/* ---------- Pages (lazy) ---------- */
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
const Settings = lazy(() => import("./pages/Settings.jsx")); // pro settings
const ClientSettings = lazy(() => import("./pages/ClientSettings.jsx")); // client settings
const AdminDecline = lazy(() => import("./pages/AdminDecline.jsx"));
const Legal = lazy(() => import("./pages/Legal.jsx"));
const ClientRegister = lazy(() => import("./pages/ClientRegister.jsx"));
const DeactivateAccount = lazy(() => import("./pages/DeactivateAccount.jsx"));
const ApplyThanks = lazy(() => import("./pages/ApplyThanks.jsx"));
const PaymentConfirm = lazy(() => import("./pages/PaymentConfirm.jsx"));
const LivenessPage = lazy(() => import("./pages/LivenessPage.jsx")); // MediaPipe version ✅
const AwsLiveness = lazy(() => import("./pages/AwsLiveness.jsx")); // AWS version ✅

/* ---------- Chatbase (verified user embedding) ---------- */
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
        // anonymous is fine
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

/* ---------- /api/me central store ---------- */
const MeContext = createContext(null);

function MeProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({
    loading: true,
    me: null,
    error: null,
  });

  // when Firebase token changes, update axios and refetch /api/me
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (user) => {
      try {
        const token = user ? await user.getIdToken() : null;
        setAuthToken(token);
      } finally {
        setVersion((v) => v + 1);
      }
    });
    return () => unsub();
  }, []);

  // initial write (page refresh)
  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        const token = u ? await u.getIdToken() : null;
        setAuthToken(token);
      } catch {
        setAuthToken(null);
      }
    })();
  }, []);

  // fetch /api/me whenever version changes
  useEffect(() => {
    let alive = true;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;
        setState({ loading: false, me: data || null, error: null });
      } catch (e) {
        if (!alive) return;
        setState({ loading: false, me: null, error: e });
      }
    })();
    return () => {
      alive = false;
    };
  }, [version]);

  const value = useMemo(() => {
    const isPro = !!state?.me?.isPro;
    const isAdmin = !!state?.me?.isAdmin;
    return {
      ...state,
      isPro,
      isAdmin,
      refresh: () => setVersion((v) => v + 1),
    };
  }, [state]);

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

function useMe() {
  const ctx = useContext(MeContext);
  return (
    ctx || {
      loading: true,
      me: null,
      isPro: false,
      isAdmin: false,
      error: null,
      refresh: () => {},
    }
  );
}

/* ---------- Role guard (admin / pro) ---------- */
function RequireRole({ role, children }) {
  const { loading, isAdmin, isPro } = useMe();
  const loc = useLocation();

  const allowed =
    role === "admin" ? isAdmin : role === "pro" ? isPro : true;

  if (loading) return <div className="p-6">Loading…</div>;
  return allowed ? (
    children
  ) : (
    <Navigate to="/" replace state={{ from: loc }} />
  );
}

/* ---------- Smart pages ---------- */
function WalletSmart() {
  const { loading, isPro } = useMe();
  if (loading) return <div className="p-6">Loading…</div>;
  return isPro ? <Wallet /> : <ClientWallet />;
}

function SettingsSmart() {
  const { loading, isPro } = useMe();
  if (loading) return <div className="p-6">Loading…</div>;
  return isPro ? <Settings /> : <ClientSettings />;
}

/* ---------- Smart “Find a pro” ---------- */
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

  return <div className="p-6">Loading…</div>;
}

/* ---------- App ---------- */
export default function App() {
  useChatbase();
  const location = useLocation();

  // 👇 hide chrome only on AWS liveness route
  const hideChrome = location.pathname.startsWith("/aws-liveness");

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      {!hideChrome && <Navbar />}

      <main className={hideChrome ? "flex-1 bg-black" : "flex-1"}>
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          <MeProvider>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Home />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/find" element={<FindProSmart />} />

              <Route path="/book/:barberId" element={<BookService />} />

              {/* Booking details require auth */}
              <Route
                path="/bookings/:id"
                element={
                  <RequireAuth>
                    <BookingDetails />
                  </RequireAuth>
                }
              />

              {/* Profile */}
              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />

              {/* Auth */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Legal */}
              <Route path="/legal" element={<Legal />} />
              <Route path="/legal/*" element={<Legal />} />
              <Route
                path="/terms"
                element={<Navigate to="/legal#terms" replace />}
              />
              <Route
                path="/privacy"
                element={<Navigate to="/legal#privacy" replace />}
              />
              <Route
                path="/cookies"
                element={<Navigate to="/legal#cookies" replace />}
              />
              <Route
                path="/refunds"
                element={<Navigate to="/legal#refunds" replace />}
              />

              {/* Application / payments */}
              <Route path="/apply/thanks" element={<ApplyThanks />} />
              <Route path="/payment/confirm" element={<PaymentConfirm />} />

              {/* Wallet */}
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

              {/* Become a Pro */}
              <Route
                path="/become"
                element={
                  <RequireAuth>
                    <BecomePro />
                  </RequireAuth>
                }
              />

              {/* ✅ OLD / MEDIAPIPE LIVENESS (keep as fallback) */}
              <Route
                path="/liveness"
                element={
                  <RequireAuth>
                    <LivenessPage />
                  </RequireAuth>
                }
              />

              {/* ✅ NEW / AWS LIVENESS */}
              <Route
                path="/aws-liveness"
                element={
                  <RequireAuth>
                    <AwsLiveness />
                  </RequireAuth>
                }
              />

              {/* ✅ client register canonical */}
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
                path="/client-register"
                element={<Navigate to="/client/register" replace />}
              />

              {/* Account deactivation */}
              <Route
                path="/deactivate"
                element={
                  <RequireAuth>
                    <DeactivateAccount />
                  </RequireAuth>
                }
              />

              {/* Pro dashboard */}
              <Route
                path="/pro-dashboard"
                element={
                  <RequireRole role="pro">
                    <ProDashboard />
                  </RequireRole>
                }
              />
              <Route
                path="/pro"
                element={<Navigate to="/pro-dashboard" replace />}
              />

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
          </MeProvider>
        </Suspense>
      </main>

      {!hideChrome && <Footer />}
    </div>
  );
}
