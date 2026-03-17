//app/web/android/app/src/main/java/touch/kpocha/app/GenericNotification.java
package touch.kpocha.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public final class GenericNotification {
    public static final String CHANNEL_ID = "alerts";
    public static final int BASE_NOTIF_ID = 56000;

    private GenericNotification() {
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
                "Alerts",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("General notifications");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    public static Notification build(
            Context ctx,
            String title,
            String body,
            String deepLinkUrl,
            String avatarUrl,
            String previewImageUrl,
            String tag) {
        ensureChannel(ctx);

        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.setData(android.net.Uri.parse(deepLinkUrl));

        int requestCode = Math.abs((tag != null ? tag : String.valueOf(System.currentTimeMillis())).hashCode());
        PendingIntent contentPi = PendingIntent.getActivity(ctx, requestCode, open, pendingFlags());

        Bitmap largeIcon = fetchBitmap(avatarUrl);
        Bitmap bigPicture = fetchBitmap(previewImageUrl);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title != null && !title.isEmpty() ? title : "Kpocha Touch")
                .setContentText(body != null ? body : "")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL);

        if (largeIcon != null) {
            b.setLargeIcon(largeIcon);
        }

        if (bigPicture != null) {
            NotificationCompat.BigPictureStyle style = new NotificationCompat.BigPictureStyle()
                    .bigPicture(bigPicture)
                    .bigLargeIcon((Bitmap) null);

            if (body != null && !body.isEmpty()) {
                style.setSummaryText(body);
            }

            b.setStyle(style);
        } else {
            b.setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""));
        }

        return b.build();
    }

    public static void show(Context ctx, String tag, Notification n) {
        int id = BASE_NOTIF_ID
                + Math.abs((tag != null ? tag : String.valueOf(System.currentTimeMillis())).hashCode() % 10000);
        NotificationManagerCompat.from(ctx).notify(id, n);
    }

    private static Bitmap fetchBitmap(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty())
            return null;

        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            URL url = new URL(rawUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setDoInput(true);
            conn.connect();

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300)
                return null;

            in = conn.getInputStream();
            return BitmapFactory.decodeStream(in);
        } catch (Exception ignored) {
            return null;
        } finally {
            try {
                if (in != null)
                    in.close();
            } catch (Exception ignored) {
            }
            try {
                if (conn != null)
                    conn.disconnect();
            } catch (Exception ignored) {
            }
        }
    }

    private static int pendingFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }
}