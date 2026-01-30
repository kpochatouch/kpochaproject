//app/web/android/app/src/main/java/touch/kpocha/app/CallNotification.java
package touch.kpocha.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class CallNotification {
    public static final String CHANNEL_ID = "calls";
    public static final int NOTIF_ID = 44001;

    public static final String ACTION_ACCEPT = "touch.kpocha.app.CALL_ACCEPT";
    public static final String ACTION_DECLINE = "touch.kpocha.app.CALL_DECLINE";

    private CallNotification() {
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26)
            return;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null)
            return;

        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null)
            return;

        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Calls",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Incoming calls");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        // ✅ calls channel must be silent; we do looping ringtone in
        // CallForegroundService
        ch.setSound(null, null);

        nm.createNotificationChannel(ch);
    }

    public static Notification buildIncoming(Context ctx, String fromName, String fromAvatar, String callId,
            String room, String callType) {
        ensureChannel(ctx);

        // Full-screen UI intent
        Intent fs = new Intent(ctx, IncomingCallActivity.class);
        fs.putExtra("callId", callId);
        fs.putExtra("room", room);
        fs.putExtra("callType", callType);
        fs.putExtra("fromName", fromName);
        fs.putExtra("fromAvatar", fromAvatar);
        fs.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent fullScreenPi = PendingIntent.getActivity(ctx, 1001, fs, pendingFlags());

        // Accept action
        Intent a = new Intent(ctx, CallActionReceiver.class);
        a.setAction(ACTION_ACCEPT);
        a.putExtra("callId", callId);
        a.putExtra("room", room);
        a.putExtra("callType", callType);
        a.putExtra("fromName", fromName);

        PendingIntent acceptPi = PendingIntent.getBroadcast(ctx, 2001, a, pendingFlags());

        // Decline action
        Intent d = new Intent(ctx, CallActionReceiver.class);
        d.setAction(ACTION_DECLINE);
        d.putExtra("callId", callId);

        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, 2002, d, pendingFlags());

        String label = (fromName != null && !fromName.isEmpty()) ? fromName : "Someone";

        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle("Incoming call")
                .setContentText(label + " is calling you")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPi, true)
                .addAction(0, "Decline", declinePi)
                .addAction(0, "Accept", acceptPi)
                .build();
    }

    public static void show(Context ctx, Notification n) {
        NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n);
    }

    public static void cancel(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_ID);
    }

    private static int pendingFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }
}
