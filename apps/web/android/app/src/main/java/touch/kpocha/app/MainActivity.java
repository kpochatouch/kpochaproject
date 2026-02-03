// apps/web/android/app/src/main/java/touch/kpocha/app/MainActivity.java
package touch.kpocha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    // ✅ Foreground tracker: used to suppress call notifications while app is open
    private static volatile boolean sIsForeground = false;

    public static boolean isAppInForeground() {
        return sIsForeground;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d(TAG, "onCreate intent=" + getIntent());
        Log.d(TAG, "onCreate data=" + (getIntent() != null ? getIntent().getDataString() : "null"));
        registerPlugin(touch.kpocha.app.NotifStatusPlugin.class);

        // ✅ Allow autoplay (including sound) without user gesture in Android WebView
        try {
            WebView webView = this.getBridge().getWebView();
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) {
        }

        createNotificationChannels();
        forwardDeepLinkOnce(getIntent());

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
            CallNotification.ensureChannel(this);
        }
    }

    // ✅ One-time deep link fallback (NO retry spam)
    // Capacitor normally delivers deep links via appUrlOpen to App.jsx.
    // This is only a safety net for cold/slow starts.
    private void forwardDeepLinkOnce(android.content.Intent intent) {
        try {
            android.net.Uri data = intent != null ? intent.getData() : null;
            if (data == null)
                return;

            final String u = data.toString(); // capacitor://localhost/...
            final String path = u.replace("capacitor://localhost", "");

            if (path == null || path.trim().length() == 0 || "/".equals(path.trim())) {
                Log.d(TAG, "forwardDeepLinkOnce: ignoring empty path");
                return;
            }

            Log.d(TAG, "forwardDeepLinkOnce path=" + path);

            final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            h.postDelayed(() -> {
                try {
                    if (getBridge() == null || getBridge().getWebView() == null)
                        return;

                    getBridge().getWebView().evaluateJavascript(
                            "window.location.href = " + org.json.JSONObject.quote(path) + ";",
                            null);
                } catch (Exception ignored) {
                }
            }, 250);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Log.d(TAG, "onNewIntent intent=" + intent);
        Log.d(TAG, "onNewIntent data=" + (intent != null ? intent.getDataString() : "null"));

        try {
            if (getBridge() != null) {
                getBridge().onNewIntent(intent);
            }
        } catch (Exception ignored) {
        }

        forwardDeepLinkOnce(intent);

    }

    @Override
    public void onResume() {
        super.onResume();
        sIsForeground = true;
    }

    @Override
    public void onPause() {
        sIsForeground = false;
        super.onPause();
    }

}