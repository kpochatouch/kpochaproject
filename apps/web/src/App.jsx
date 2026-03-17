// apps/web/src/App.jsx
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { api, registerSocketHandler } from "./lib/api";
import CallSheet from "./components/CallSheet.jsx";
import InstallPWAButton from "./components/InstallPWAButton.jsx";
import { ToastProvider } from "./components/Toast.jsx";

import Navbar from "./components/Navbar.jsx";
import Footer from "./components/Footer.jsx";
import ClickOutsideLayer from "./components/ClickOutsideLayer.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import RouteLoader from "./components/RouteLoader.jsx";
import { useMe } from "./context/MeContext.jsx";
import BookingAlert from "./components/BookingAlert.jsx";
import usePostPaymentRecovery from "./hooks/usePostPaymentRecovery";
import { ensurePushSubscribed, getDeviceId } from "./lib/pushClient";
import MobileTabBar from "./components/MobileTabBar.jsx";
import PullToRefresh from "./components/PullToRefresh.jsx";
console.log("[push] App.jsx loaded");

// ---------- pages (lazy) ----------
const Home = lazy(() => import("./pages/Home.jsx"));
const Browse = lazy(() => import("./pages/Browse.jsx"));
const BookService = lazy(() => import("./pages/BookService.jsx"));
const BookingDetails = lazy(() => import("./pages/BookingDetails.jsx"));
const BookingChat = lazy(() => import("./pages/BookingChat.jsx"));
const Wallet = lazy(() => import("./pages/Wallet.jsx"));
const ClientWallet = lazy(() => import("./pages/ClientWallet.jsx"));
const ClientDashboard = lazy(() => import("./pages/ClientDashboard.jsx"));
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
const PostDetail = lazy(() => import("./pages/PostDetail.jsx"));
const PublicProfile = lazy(() => import("./pages/PublicProfile.jsx"));
const ForYou = lazy(() => import("./pages/ForYou.jsx"));
const Inbox = lazy(() => import("./pages/Inbox.jsx"));
const LeaveReview = lazy(() => import("./pages/LeaveReview.jsx"));
const LeaveClientReview = lazy(() => import("./pages/LeaveClientReview.jsx"));
const Contact = lazy(() => import("./pages/Contact.jsx"));
const StoryCompose = lazy(() => import("./pages/StoryCompose.jsx"));
const AdvertCompose = lazy(() => import("./pages/AdvertCompose.jsx"));
const MyAdverts = lazy(() => import("./pages/MyAdverts.jsx"));
const AdvertEdit = lazy(() => import("./pages/AdvertEdit.jsx"));
const AdminAdvertsReview = lazy(() => import("./pages/AdminAdvertsReview.jsx"));
const NotificationsPage = lazy(() => import("./pages/Notifications.jsx"));

/* ---------- Chatbase hook ---------- */
function useChatbase(enabled) {
  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled]);
}

/* ---------- Chatbase: load-on-demand (mobile) ---------- */
function ensureChatbaseLoaded() {
  const CHATBOT_ID = import.meta.env.VITE_CHATBASE_ID;
  if (!CHATBOT_ID) return false;

  // already loaded
  if (document.getElementById(CHATBOT_ID)) return true;

  // bootstrap chatbase queue (official-ish pattern)
  if (!window.chatbase || window.chatbase("getState") !== "initialized") {
    const q = (...args) => {
      if (!window.chatbase.q) window.chatbase.q = [];
      window.chatbase.q.push(args);
    };
    window.chatbase = new Proxy(q, {
      get(target, prop) {
        if (prop === "q") return target.q;
        return (...args) => target(prop, ...args);
      },
    });
  }

  window.chatbaseConfig = { chatbotId: CHATBOT_ID };

  const s = document.createElement("script");
  s.src = "https://www.chatbase.co/embed.min.js";
  s.id = CHATBOT_ID;
  s.defer = true;
  s.dataset.domain = "www.chatbase.co";
  document.body.appendChild(s);

  return true;
}

/* ---------- role guards ---------- */
function RequireRole({ role, children }) {
  const { loading, isAdmin, isPro } = useMe();
  const loc = useLocation();

  const allowed = role === "admin" ? isAdmin : role === "pro" ? isPro : true;

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

async function initNativePush(apiClient, listenersBoundRef) {
  console.log(
    "[push] initNativePush reached. isNative=",
    Capacitor.isNativePlatform(),
  );
  if (!Capacitor.isNativePlatform()) return;

  const shouldBindListeners = !listenersBoundRef?.current;
  if (listenersBoundRef) listenersBoundRef.current = true;

  // Android 13+ needs runtime permission
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") {
    console.log("[push] permission not granted:", perm);
    return;
  }

  await PushNotifications.register();
  if (!shouldBindListeners) return;

  PushNotifications.addListener("registration", async (t) => {
    console.log("[push] FCM token:", t?.value);

    try {
      const nativeSurfaceKey = getDeviceId();

      await apiClient.post("/api/push/device-token", {
        token: t?.value,
        platform: "android",
        deviceId: nativeSurfaceKey,
        surfaceType: "native",
        surfaceKey: nativeSurfaceKey,
      });

      console.log("[push] token saved to backend");
    } catch (e) {
      console.log("[push] failed to save token:", e?.message || e);
    }
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.log("[push] registration error:", JSON.stringify(err));
  });

  PushNotifications.addListener("pushNotificationReceived", (notif) => {
    console.log(
      "[push] received data:",
      JSON.stringify(notif?.data || notif?.extra || {}),
    );
    console.log("[push] received:", JSON.stringify(notif));
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    try {
      console.log("[push] actionPerformed raw:", JSON.stringify(action));

      // ✅ DEBUG: show what data we actually got on tap
      console.log(
        "[push] actionPerformed notification keys:",
        Object.keys(action?.notification || {}),
      );

      const data =
        action?.notification?.data ||
        action?.notification?.extra ||
        action?.notification ||
        {};

      const type = data?.type;

      console.log("[push] actionPerformed data:", JSON.stringify(data));
      console.log("[push] actionPerformed type:", type);

      // ✅ Incoming call → open Call UI via your existing URL handler
      if (
        (type === "incoming_call" || type === "call_incoming") &&
        data?.room
      ) {
        const qs = new URLSearchParams();
        qs.set("call", "1");
        qs.set("accept", "1");
        if (data.callId) qs.set("callId", String(data.callId));
        qs.set("room", String(data.room));
        if (data.callType) qs.set("callType", String(data.callType));
        if (data.fromName) qs.set("fromName", String(data.fromName));
        if (data.fromAvatar) qs.set("fromAvatar", String(data.fromAvatar));

        console.log(
          "[push] routing -> call deep link:",
          `/browse?${qs.toString()}`,
        );
        window.location.href = `/browse?${qs.toString()}`;
        return;
      }

      // ✅ Booking → open BookingDetails (/bookings/:id)
      if (type === "booking_paid" && data?.bookingId) {
        const to = `/bookings/${String(data.bookingId)}`;
        console.log("[push] routing -> booking:", to);
        window.location.href = to;
        return;
      }

      // default fallback
      window.location.href = "/browse";
    } catch (e) {
      window.location.href = "/browse";
    }
  });
}

/**
 * FindProSmart: used when user taps "Find a Pro"
 * - If not logged in → send to /login
 * - If logged in but no client profile → /client/register
 * - Else → /browse?tab=pros (Discover page, Pros tab)
 */
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
          // ✅ Go to Discover with Pros tab selected
          navigate("/browse?tab=pros", { replace: true });
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
  const location = useLocation();

  const hideChatbase =
    location.pathname.startsWith("/chat") ||
    location.pathname.startsWith("/inbox") ||
    (location.pathname.includes("/bookings/") &&
      location.pathname.endsWith("/chat"));

  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  // Desktop: keep chatbase as before
  // Mobile: do NOT autoload chatbase
  useChatbase(!hideChatbase && !isMobile);

  const navigate = useNavigate();

  const { me } = useMe();

  // ✅ Native FCM registration (Android APK)
  const didInitNativePushRef = useRef("");

  const nativePushListenersBoundRef = useRef(false);

  useEffect(() => {
    if (didInitNativePushRef.current === me?.uid) return;
    if (!me?.uid) return;

    didInitNativePushRef.current = me?.uid || "";

    initNativePush(api, nativePushListenersBoundRef).catch((e) => {
      console.log("[push] init failed:", e?.message || e);
    });
  }, [me?.uid]);

  const handledCallParamRef = useRef(false);
  const [activeCall, setActiveCall] = useState(null);
  const [callUiMode, setCallUiMode] = useState("expanded");

  useEffect(() => {
    function onStartGlobalCall(event) {
      const detail = event?.detail || {};
      if (!detail?.room) return;

      setActiveCall({
        open: true,
        callId: detail.callId || null,
        room: detail.room,
        callType: detail.callType || "audio",
        role: detail.role || "caller",
        fromUid: detail.fromUid || null,
        meta: {
          ...(detail.meta || {}),
        },
      });

      setCallUiMode("expanded");
    }

    window.addEventListener("kpocha:start-call", onStartGlobalCall);
    return () => {
      window.removeEventListener("kpocha:start-call", onStartGlobalCall);
    };
  }, []);

  // ✅ Native deep-link support (works with notification taps on some devices)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const sub = CapApp.addListener("appUrlOpen", (event) => {
      try {
        const url = event?.url || "";
        if (!url) return;

        // event.url can be like: capacitor://localhost/browse?call=1&room=...
        const u = new URL(url);
        const path = u.pathname || "/";
        const search = u.search || "";

        navigate({ pathname: path, search }, { replace: true });
      } catch {}
    });

    return () => {
      try {
        sub.remove();
      } catch {}
    };
  }, [navigate]);

  useEffect(() => {
    const qs = new URLSearchParams(location.search || "");
    const isCall = qs.get("call") === "1";

    if (!isCall) {
      if (activeCall?.room) return;
      handledCallParamRef.current = false;
      return;
    }

    if (handledCallParamRef.current) return;
    handledCallParamRef.current = true;

    const callId = qs.get("callId") || null;
    const room = qs.get("room") || null;
    const callType = qs.get("callType") || "audio";
    const shouldAccept = qs.get("accept") === "1";
    const fromName = qs.get("fromName") || "";
    const fromAvatar = qs.get("fromAvatar") || "";

    if (activeCall?.callId && activeCall.callId === callId) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        let liveCall = null;

        if (callId) {
          const { data } = await api.get(
            `/api/call/${encodeURIComponent(callId)}`,
          );
          liveCall = data?.item || null;
        }

        if (cancelled) return;

        const terminalStatuses = [
          "ended",
          "missed",
          "cancelled",
          "declined",
          "failed",
        ];

        if (
          !liveCall ||
          liveCall.endedAt ||
          terminalStatuses.includes(liveCall.status)
        ) {
          setActiveCall(null);
          setCallUiMode("expanded");
          navigate("/inbox", { replace: true });
          return;
        }

        // ✅ If notification/deep-link means "answer this call",
        // backend must confirm it BEFORE we open CallSheet.
        if (shouldAccept && callId) {
          await api.post(`/api/calls/${encodeURIComponent(callId)}/accept`);
        }

        if (cancelled) return;

        const finalRoom = liveCall?.room || room;
        const finalCallType = liveCall?.callType || callType;

        if (!finalRoom) {
          navigate("/inbox", { replace: true });
          return;
        }

        setActiveCall({
          open: true,
          callId,
          room: finalRoom,
          callType: finalCallType,
          role: "receiver",
          fromUid: null,
          meta: {
            fromName,
            fromAvatar,
            callerName: fromName,
            callerAvatar: fromAvatar,
            autoAccept: shouldAccept,
          },
        });

        setCallUiMode("expanded");
      } catch (e) {
        console.warn(
          "[App] incoming call deep-link rejected:",
          e?.message || e,
        );

        setActiveCall(null);
        setCallUiMode("expanded");
        navigate("/inbox", { replace: true });
      } finally {
        qs.delete("call");
        qs.delete("callId");
        qs.delete("room");
        qs.delete("callType");
        qs.delete("accept");
        qs.delete("fromName");
        qs.delete("fromAvatar");

        const nextSearch = qs.toString();
        navigate(
          {
            pathname: location.pathname,
            search: nextSearch ? `?${nextSearch}` : "",
          },
          { replace: true },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, navigate, activeCall]);

  // MobileTabBar: tap Help -> load Chatbase on demand (mobile only)
  useEffect(() => {
    if (!isMobile) return;

    function onOpenChatbase() {
      const ok = ensureChatbaseLoaded();
      if (!ok) return;

      // try to open if API exists; otherwise user can tap the bubble
      setTimeout(() => {
        try {
          window.chatbase?.("open");
        } catch {}
      }, 250);
    }

    window.addEventListener("kpocha:open-chatbase", onOpenChatbase);
    return () =>
      window.removeEventListener("kpocha:open-chatbase", onOpenChatbase);
  }, [isMobile]);

  // 🔔 Web/PWA only: subscribe for Web Push (never inside native Capacitor)
  useEffect(() => {
    if (!me?.uid) return;
    if (Capacitor.isNativePlatform()) return; // ✅ native uses FCM only
    ensurePushSubscribed().catch(() => {});
  }, [me?.uid]);

  usePostPaymentRecovery(me);

  const myLabel =
    me?.displayName ||
    me?.fullName ||
    me?.username ||
    me?.email ||
    me?.uid ||
    "You";

  // Global listener for incoming calls
  useEffect(() => {
    // when server emits "call:incoming"
    const offIncoming = registerSocketHandler("call:incoming", (payload) => {
      if (!payload) return;

      setActiveCall({
        open: true,
        callId: payload.callId,
        room: payload.room,
        callType: payload.callType || "audio",
        role: "receiver",
        fromUid: payload.callerUid,
        meta: payload.meta || {},
      });

      setCallUiMode("expanded");
    });

    // remove active call only when call truly ends
    const offStatus = registerSocketHandler("call:status", (payload) => {
      if (!payload) return;

      if (
        ["ended", "missed", "cancelled", "declined", "failed"].includes(
          payload.status,
        )
      ) {
        setActiveCall((prev) => {
          if (!prev) return prev;

          const sameCallId =
            prev.callId && payload.callId && prev.callId === payload.callId;

          const sameRoom =
            prev.room &&
            payload.room &&
            String(prev.room) === String(payload.room);

          return sameCallId || sameRoom ? null : prev;
        });

        setCallUiMode("expanded");
      }
    });

    return () => {
      offIncoming();
      offStatus();
    };
  }, []);

  // Listener for AWS liveness events
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
        } catch {
          // ignore
        }
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
    <ToastProvider>
      <div className="min-h-screen flex flex-col bg-black text-white">
        <PullToRefresh disabled={Boolean(activeCall?.room)} />

        {/* global click → custom event used by menus/overlays */}
        <ClickOutsideLayer />

        {!hideChrome && <Navbar />}

        {!hideChrome && me?.isPro && (
          <BookingAlert pollMs={15000} playSound={true} />
        )}

        <main
          className={
            hideChrome ? "flex-1 bg-black" : "flex-1 pb-[78px] md:pb-0"
          }
        >
          <Suspense fallback={<RouteLoader full />}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Navigate to="/browse" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/post/:id" element={<PostDetail />} />
              <Route path="/home" element={<Home />} />
              <Route
                path="/for-you"
                element={
                  <RequireAuth>
                    <ForYou />
                  </RequireAuth>
                }
              />
              <Route
                path="/for-you/:id"
                element={
                  <RequireAuth>
                    <ForYou />
                  </RequireAuth>
                }
              />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/legal" element={<Legal />} />
              <Route path="/legal/*" element={<Legal />} />
              <Route path="/profile/:username" element={<PublicProfile />} />
              <Route path="/apply/thanks" element={<ApplyThanks />} />
              <Route
                path="/contact"
                element={
                  <RequireAuth>
                    <Contact />
                  </RequireAuth>
                }
              />
              {/* Entry to “Find a Pro” flow */}
              <Route path="/find" element={<FindProSmart />} />
              {/* Booking page must be authenticated */}
              <Route
                path="/book/:barberId"
                element={
                  <RequireAuth>
                    <BookService />
                  </RequireAuth>
                }
              />
              {/* Auth-required core pages */}
              <Route
                path="/compose"
                element={
                  <RequireAuth>
                    <Compose />
                  </RequireAuth>
                }
              />

              <Route
                path="/stories/create"
                element={
                  <RequireAuth>
                    <StoryCompose />
                  </RequireAuth>
                }
              />
              <Route
                path="/bookings/:id"
                element={
                  <RequireAuth>
                    <BookingDetails />
                  </RequireAuth>
                }
              />
              <Route
                path="/bookings/:bookingId/chat"
                element={
                  <RequireAuth>
                    <BookingChat />
                  </RequireAuth>
                }
              />
              {/* Review Pages */}
              <Route
                path="/review/:proId"
                element={
                  <RequireAuth>
                    <LeaveReview />
                  </RequireAuth>
                }
              />
              <Route
                path="/review-client/:clientUid"
                element={
                  <RequireAuth>
                    <LeaveClientReview />
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
                path="/pro/client-wallet"
                element={
                  <RequireAuth>
                    <RequireRole role="pro">
                      <ClientWallet />
                    </RequireRole>
                  </RequireAuth>
                }
              />
              <Route
                path="/my-bookings"
                element={
                  <RequireAuth>
                    <ClientDashboard />
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
              {/* legacy /register → client register */}
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
                path="/chat"
                element={
                  <RequireAuth>
                    <Chat />
                  </RequireAuth>
                }
              />
              {/* Inbox (message list) */}
              <Route
                path="/inbox"
                element={
                  <RequireAuth>
                    <Inbox />
                  </RequireAuth>
                }
              />
              {/* Role-based dashboards */}
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
                path="/adverts/new"
                element={
                  <RequireAuth>
                    <AdvertCompose />
                  </RequireAuth>
                }
              />
              <Route
                path="/my-adverts"
                element={
                  <RequireAuth>
                    <MyAdverts />
                  </RequireAuth>
                }
              />
              <Route
                path="/adverts/:id/edit"
                element={
                  <RequireAuth>
                    <AdvertEdit />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/adverts"
                element={
                  <RequireRole role="admin">
                    <AdminAdvertsReview />
                  </RequireRole>
                }
              />
              <Route
                path="/notifications"
                element={
                  <RequireAuth>
                    <NotificationsPage />
                  </RequireAuth>
                }
              />
              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/browse" replace />} />
            </Routes>
          </Suspense>
        </main>

        {!hideChrome && (
          <>
            <div className="hidden md:block">
              <Footer />
            </div>
            <MobileTabBar me={me} />
          </>
        )}
        {activeCall?.room && (
          <CallSheet
            role={activeCall?.role || "receiver"}
            room={activeCall.room}
            callId={activeCall.callId || null}
            callType={activeCall.callType || "audio"}
            me={myLabel}
            peerName={
              activeCall?.meta?.peerName ||
              activeCall?.meta?.fromName ||
              activeCall?.meta?.callerName ||
              ""
            }
            peerAvatar={
              activeCall?.meta?.peerAvatar ||
              activeCall?.meta?.fromAvatar ||
              activeCall?.meta?.callerAvatar ||
              ""
            }
            peerVerified={Boolean(
              activeCall?.meta?.peerVerified || activeCall?.meta?.fromVerified,
            )}
            autoAccept={Boolean(activeCall?.meta?.autoAccept)}
            chatRoom={activeCall?.meta?.chatRoom || null}
            uiMode={callUiMode}
            onClose={() => setCallUiMode("minimized")}
            onRestore={() => setCallUiMode("expanded")}
            onEnd={() => {
              setActiveCall(null);
              setCallUiMode("expanded");
            }}
            onMessage={() => {
              setCallUiMode("minimized");

              if (activeCall?.meta?.chatPath) {
                navigate(activeCall.meta.chatPath);
                return;
              }

              if (activeCall?.meta?.chatRoom) {
                navigate(
                  `/chat?room=${encodeURIComponent(activeCall.meta.chatRoom)}`,
                );
                return;
              }

              navigate("/chat");
            }}
          />
        )}
        <InstallPWAButton />
      </div>
    </ToastProvider>
  );
}
