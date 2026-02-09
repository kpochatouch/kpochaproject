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
    // ✅ Foreground tracker: used to suppress call notifications while app is open
    private static volatile boolean sIsForeground = false;

    public static boolean isAppInForeground() {
        return sIsForeground;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(touch.kpocha.app.NativeVideoPlayerPlugin.class);
        registerPlugin(touch.kpocha.app.NativeFeedPlugin.class);
        android.util.Log.i("NativeFeed", "✅ NativeFeedPlugin REGISTERED in MainActivity");

        // ✅ Allow autoplay (including sound) without user gesture in Android WebView
        try {
            WebView webView = this.getBridge().getWebView();
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) {
        }

        createNotificationChannels();

        // ✅ Cold-start deep link fallback (when app was closed)
        try {
            android.net.Uri data = getIntent() != null ? getIntent().getData() : null;
            if (data != null && getBridge() != null && getBridge().getWebView() != null) {
                final String u = data.toString(); // capacitor://localhost/...
                getBridge().getWebView().post(() -> {
                    try {
                        String path = u.replace("capacitor://localhost", "");
                        getBridge().getWebView().evaluateJavascript(
                                "window.location.href = " + org.json.JSONObject.quote(path) + ";",
                                null);
                    } catch (Exception ignored2) {
                    }
                });
            }
        } catch (Exception ignored) {
        }

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

    @Override
    public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        try {
            if (getBridge() != null) {
                getBridge().onNewIntent(intent);
            }
        } catch (Exception ignored) {
        }

        // ✅ HARD fallback: if appUrlOpen doesn't fire on this device, force the WebView
        // route
        try {
            android.net.Uri data = intent != null ? intent.getData() : null;
            if (data != null && getBridge() != null && getBridge().getWebView() != null) {
                final String u = data.toString(); // e.g. capacitor://localhost/browse?call=1...
                getBridge().getWebView().post(() -> {
                    try {
                        // turn capacitor://localhost/... into a normal in-app path for the SPA
                        String path = u.replace("capacitor://localhost", "");
                        getBridge().getWebView().evaluateJavascript(
                                "window.location.href = " + org.json.JSONObject.quote(path) + ";",
                                null);
                    } catch (Exception ignored2) {
                    }
                });
            }
        } catch (Exception ignored) {
        }
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