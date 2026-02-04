//app/web/android/app/src/main/java/touch/kpocha/app/CallMessagingService.java
package touch.kpocha.app;

import android.content.Intent;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class CallMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        if (msg.getData() == null)
            return;

        String type = msg.getData().get("type");

        // ✅ CALL
        if ("incoming_call".equals(type)) {
            String callId = msg.getData().get("callId");

            // ✅ If this call was already accepted, ignore any late/duplicate push
            try {
                if (CallSession.isAccepted(callId)) {
                    return;
                }
            } catch (Exception ignored) {
            }

            // ✅ If user is already inside the app, do NOT show native call UI / banner.
            if (MainActivity.isAppInForeground()) {
                return;
            }

            String room = msg.getData().get("room");
            String callType = msg.getData().get("callType");
            String fromName = msg.getData().get("fromName");
            String fromAvatar = msg.getData().get("fromAvatar") != null
                    ? msg.getData().get("fromAvatar")
                    : msg.getData().get("callerAvatar");

            // ✅ DEDUPE (MUST be last, because it mutates active-call state)
            try {
                if (!CallSession.shouldStartIncoming(callId)) {
                    return;
                }
            } catch (Exception ignored) {
            }

            Intent svc = new Intent(this, CallForegroundService.class);
            svc.putExtra("callId", callId);
            svc.putExtra("room", room);
            svc.putExtra("callType", callType);
            svc.putExtra("fromName", fromName);
            svc.putExtra("fromAvatar", fromAvatar);

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
            return;
        }

        // ✅ BOOKING RING (alarm-like)
        if ("booking_paid".equals(type)) {
            String ring = msg.getData().get("ring"); // "1" enables alarm ring
            if (!"1".equals(ring))
                return;

            String bookingId = msg.getData().get("bookingId");
            String title = msg.getData().get("title");
            String body = msg.getData().get("body");
            String ringSeconds = msg.getData().get("ringSeconds"); // optional

            Intent svc = new Intent(this, BookingRingService.class);
            svc.putExtra("bookingId", bookingId);
            svc.putExtra("title", title != null ? title : "New booking available");
            svc.putExtra("body", body != null ? body : "Tap to view details and accept");
            svc.putExtra("ringSeconds", ringSeconds != null ? ringSeconds : "20");
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }

        }
    }
}