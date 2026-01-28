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

            NotificationChannel calls = new NotificationChannel(
                    "calls",
                    "Calls",
                    NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Incoming calls");
            calls.enableVibration(true);
            calls.enableLights(true);
            calls.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(calls);

            NotificationChannel alerts = new NotificationChannel(
                    "alerts",
                    "Alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Booking and important alerts");
            alerts.enableVibration(true);
            alerts.enableLights(true);
            alerts.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(alerts);
        }
    }
}
