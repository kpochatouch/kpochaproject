//apps/web/android/app/src/main/java/touch/kpocha/app/CallSession.java
package touch.kpocha.app;

public final class CallSession {
    private static volatile String sActiveCallId = null; // call currently ringing/handled
    private static volatile long sActiveSinceMs = 0L; // when active started
    private static volatile String sAcceptedCallId = null; // accepted call (ignore late pushes)

    // How long we allow "active" to block other calls before we assume it's stuck.
    // Must be >= your ringSeconds max. If ringSeconds can be up to 120, use 150.
    private static final long ACTIVE_TTL_MS = 150_000L;

    private CallSession() {
    }

    public static synchronized boolean shouldStartIncoming(String callId) {
        callId = norm(callId);

        // If already accepted, never start incoming again for that callId
        if (eq(sAcceptedCallId, callId))
            return false;

        // If no active, take it
        if (isEmpty(sActiveCallId)) {
            sActiveCallId = callId;
            sActiveSinceMs = now();
            return true;
        }

        // Same callId duplicate: ignore
        if (eq(sActiveCallId, callId))
            return false;

        // Different callId while active exists:
        // Only allow if active is stale (stuck) past TTL.
        if (isActiveStaleLocked()) {
            sActiveCallId = callId;
            sActiveSinceMs = now();
            return true;
        }

        // Active is still fresh -> reject new call
        return false;
    }

    public static synchronized void markAccepted(String callId) {
        callId = norm(callId);
        sAcceptedCallId = callId;
        sActiveCallId = callId;
        sActiveSinceMs = now();
    }

    public static synchronized void clearActiveIfMatches(String callId) {
        callId = norm(callId);
        if (eq(sActiveCallId, callId)) {
            sActiveCallId = null;
            sActiveSinceMs = 0L;
        }
    }

    public static synchronized void clearIfMatches(String callId) {
        callId = norm(callId);
        if (eq(sActiveCallId, callId)) {
            sActiveCallId = null;
            sActiveSinceMs = 0L;
        }
        if (eq(sAcceptedCallId, callId)) {
            sAcceptedCallId = null;
        }
    }

    public static synchronized boolean isAccepted(String callId) {
        callId = norm(callId);
        return eq(sAcceptedCallId, callId);
    }

    // ---------- helpers ----------
    private static String norm(String s) {
        if (s == null)
            return "";
        return s.trim();
    }

    private static boolean isEmpty(String s) {
        return s == null || s.isEmpty();
    }

    private static boolean eq(String a, String b) {
        if (a == null)
            return b == null;
        return a.equals(b);
    }

    private static long now() {
        return android.os.SystemClock.uptimeMillis();
    }

    private static boolean isActiveStaleLocked() {
        if (isEmpty(sActiveCallId))
            return false;
        long age = now() - sActiveSinceMs;
        return age > ACTIVE_TTL_MS;
    }
}
