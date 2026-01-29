// apps/web/android/app/src/main/java/touch/kpocha/app/MainActivity.java
package touch.kpocha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ✅ Allow autoplay (including sound) without user gesture in Android WebView
        try {
            WebView webView = this.getBridge().getWebView();
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) {
        }

        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null)
                return;

            // ✅ Option A: DO NOT create "calls" channel here.
            // Calls channel is created by CallNotification.ensureChannel() with ringtone
            // sound.

            NotificationChannel alerts = new NotificationChannel(
                    "alerts",
                    "Alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Booking and important alerts");
            alerts.enableVibration(true);
            alerts.enableLights(true);
            alerts.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

            // ✅ sound at channel level (Android channels are immutable once created)
            try {
                android.net.Uri sound = android.provider.Settings.System.DEFAULT_NOTIFICATION_URI;
                android.media.AudioAttributes aa = new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                alerts.setSound(sound, aa);
            } catch (Exception ignored) {
            }

            nm.createNotificationChannel(alerts);
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

}