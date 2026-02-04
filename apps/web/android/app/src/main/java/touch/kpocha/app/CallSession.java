//apps/web/android/app/src/main/java/touch/kpocha/app/CallSession.java
package touch.kpocha.app;

public final class CallSession {
    private static volatile String sActiveCallId = null; // call currently ringing/handled
    private static volatile String sAcceptedCallId = null; // call already accepted (ignore late pushes)

    private CallSession() {
    }

    public static synchronized boolean shouldStartIncoming(String callId) {
        if (callId == null)
            callId = "";
        callId = callId.trim();

        // If we already accepted this call, never start incoming again
        if (sAcceptedCallId != null && sAcceptedCallId.equals(callId)) {
            return false;
        }

        // If no active call, allow and set it
        if (sActiveCallId == null || sActiveCallId.isEmpty()) {
            sActiveCallId = callId;
            return true;
        }

        // Same callId re-fired: ignore duplicate start
        if (sActiveCallId.equals(callId)) {
            return false;
        }

        // Different callId while one is already active:
        // safest behavior: ignore (prevents 2 concurrent incoming UIs)
        return false;
    }

    public static synchronized void markAccepted(String callId) {
        if (callId == null)
            callId = "";
        callId = callId.trim();
        sAcceptedCallId = callId;
        sActiveCallId = callId;
    }

    public static synchronized void clearActiveIfMatches(String callId) {
        if (callId == null)
            callId = "";
        callId = callId.trim();

        if (sActiveCallId != null && sActiveCallId.equals(callId)) {
            sActiveCallId = null;
        }
    }

    public static synchronized void clearIfMatches(String callId) {
        if (callId == null)
            callId = "";
        callId = callId.trim();

        if (sActiveCallId != null && sActiveCallId.equals(callId))
            sActiveCallId = null;
        if (sAcceptedCallId != null && sAcceptedCallId.equals(callId))
            sAcceptedCallId = null;
    }

    public static synchronized boolean isAccepted(String callId) {
        if (callId == null)
            callId = "";
        callId = callId.trim();
        return sAcceptedCallId != null && sAcceptedCallId.equals(callId);
    }
}
