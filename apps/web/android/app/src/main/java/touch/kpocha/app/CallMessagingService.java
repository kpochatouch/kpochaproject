//app/web/android/app/src/main/java/touch/kpocha/app/CallMessagingService.java
package touch.kpocha.app;

import android.content.Intent;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class CallMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        if (msg.getData() == null)
            return;

        Map<String, String> data = msg.getData();
        String type = data.get("type");
        if (type == null)
            type = "generic";

        // ✅ CALL
        if ("incoming_call".equals(type)) {
            String callId = data.get("callId");

            // If app is foreground, do not show native full-screen ringing UI
            if (MainActivity.isAppInForeground()) {
                return;
            }

            String room = data.get("room");
            String callType = data.get("callType");
            String fromName = data.get("fromName");
            String fromAvatar = data.get("fromAvatar") != null
                    ? data.get("fromAvatar")
                    : data.get("callerAvatar");

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
            String ring = data.get("ring");
            if ("1".equals(ring)) {
                String bookingId = data.get("bookingId");
                String title = data.get("title");
                String body = data.get("body");
                String ringSeconds = data.get("ringSeconds");

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
                return;
            }
        }

        // ✅ Ordinary notifications: if app is foreground, let in-app UI handle it
        if (MainActivity.isAppInForeground()) {
            return;
        }

        String title = value(data, "title", "Kpocha Touch");
        String body = value(data, "body", "");

        String avatarUrl = firstNonEmpty(
                data.get("actorAvatar"),
                data.get("fromAvatar"),
                data.get("callerAvatar"));

        String previewUrl = firstNonEmpty(
                data.get("image"),
                data.get("thumbnailUrl"),
                data.get("previewImage"),
                data.get("postThumbnail"));

        String deepLink = buildDeepLink(data);
        String tag = buildTag(data, type);

        GenericNotification.show(
                this,
                tag,
                GenericNotification.build(
                        this,
                        title,
                        body,
                        deepLink,
                        avatarUrl,
                        previewUrl,
                        tag));
    }

    private static String buildDeepLink(Map<String, String> data) {
        String type = value(data, "type", "generic");

        if ("chat_message".equals(type)) {
            String peerUid = firstNonEmpty(
                    data.get("peerUid"),
                    data.get("fromUid"),
                    data.get("actorUid"),
                    data.get("callerUid"));

            if (peerUid != null && !peerUid.isEmpty()) {
                return "capacitor://localhost/chat?with=" + encode(peerUid);
            }

            String room = data.get("room");
            if (room != null && !room.isEmpty()) {
                return "capacitor://localhost/chat?room=" + encode(room);
            }

            return "capacitor://localhost/inbox";
        }

        if ("call_missed".equals(type)) {
            String peerUid = firstNonEmpty(
                    data.get("peerUid"),
                    data.get("fromUid"),
                    data.get("callerUid"));

            if (peerUid != null && !peerUid.isEmpty()) {
                return "capacitor://localhost/chat?with=" + encode(peerUid);
            }

            String room = data.get("room");
            if (room != null && !room.isEmpty()) {
                return "capacitor://localhost/chat?room=" + encode(room);
            }

            return "capacitor://localhost/inbox";
        }

        if ("post_like".equals(type) ||
                "post_comment".equals(type) ||
                "post_view".equals(type) ||
                "new_post".equals(type)) {
            String postId = data.get("postId");
            if (postId != null && !postId.isEmpty()) {
                return "capacitor://localhost/post/" + encode(postId);
            }
            return "capacitor://localhost/browse";
        }

        if ("follow".equals(type)) {
            String username = data.get("username");
            if (username != null && !username.isEmpty()) {
                return "capacitor://localhost/profile/" + encode(username);
            }
            return "capacitor://localhost/browse";
        }

        if ("booking_update".equals(type) || "booking_paid".equals(type)) {
            String bookingId = data.get("bookingId");
            if (bookingId != null && !bookingId.isEmpty()) {
                return "capacitor://localhost/bookings/" + encode(bookingId);
            }
            return "capacitor://localhost/my-bookings";
        }

        if ("withdraw".equals(type) ||
                "withdraw_pending".equals(type) ||
                "booking_fund".equals(type) ||
                "booking_fund_refund".equals(type) ||
                "release".equals(type)) {
            return "capacitor://localhost/wallet";
        }

        return "capacitor://localhost/browse";
    }

    private static String buildTag(Map<String, String> data, String type) {
        String callId = data.get("callId");
        if (callId != null && !callId.isEmpty())
            return "call:" + callId;

        String bookingId = data.get("bookingId");
        if (bookingId != null && !bookingId.isEmpty())
            return "booking:" + bookingId;

        String postId = data.get("postId");
        if (postId != null && !postId.isEmpty())
            return type + ":post:" + postId;

        String room = data.get("room");
        if (room != null && !room.isEmpty())
            return type + ":room:" + room;

        String notificationId = data.get("notificationId");
        if (notificationId != null && !notificationId.isEmpty())
            return "notif:" + notificationId;

        return type + ":" + System.currentTimeMillis();
    }

    private static String value(Map<String, String> data, String key, String fallback) {
        String v = data.get(key);
        return v != null && !v.isEmpty() ? v : fallback;
    }

    private static String firstNonEmpty(String... values) {
        if (values == null)
            return "";
        for (String v : values) {
            if (v != null && !v.isEmpty())
                return v;
        }
        return "";
    }

    private static String encode(String v) {
        try {
            return java.net.URLEncoder.encode(v, "UTF-8");
        } catch (Exception ignored) {
            return v;
        }
    }
}