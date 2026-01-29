//app/web/android/app/src/main/java/touch/kpocha/app/BookingNotification.java
package touch.kpocha.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class BookingNotification {
    public static final String CHANNEL_ID = "alerts";
    public static final int NOTIF_ID = 55001;

    public static final String ACTION_ACCEPT = "touch.kpocha.app.BOOKING_ACCEPT";
    public static final String ACTION_DECLINE = "touch.kpocha.app.BOOKING_DECLINE";

    private BookingNotification() {
    }

    public static Notification build(Context ctx, String bookingId, String title, String body) {
        // Tap opens booking details
        String url = "capacitor://localhost/bookings/" + safe(bookingId);
        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.setData(android.net.Uri.parse(url));
        PendingIntent contentPi = PendingIntent.getActivity(ctx, 3001, open, pendingFlags());

        // Accept action (opens booking details too — where Accept is performed)
        Intent a = new Intent(ctx, BookingActionReceiver.class);
        a.setAction(ACTION_ACCEPT);
        a.putExtra("bookingId", bookingId);
        PendingIntent acceptPi = PendingIntent.getBroadcast(ctx, 3002, a, pendingFlags());

        // Decline action (stops ring + dismiss)
        Intent d = new Intent(ctx, BookingActionReceiver.class);
        d.setAction(ACTION_DECLINE);
        d.putExtra("bookingId", bookingId);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, 3003, d, pendingFlags());

        String t = (title != null && !title.isEmpty()) ? title : "New booking";
        String b = (body != null) ? body : "A client is requesting service";

        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(t)
                .setContentText(b)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(b))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(contentPi)
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

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
