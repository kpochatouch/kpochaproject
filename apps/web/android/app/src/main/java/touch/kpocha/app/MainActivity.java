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
        registerPlugin(touch.kpocha.app.NotifStatusPlugin.class);

        // ✅ Allow autoplay (including sound) without user gesture in Android WebView
        try {
            WebView webView = this.getBridge().getWebView();
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) {
        }

        createNotificationChannels();

        // ✅ Cold-start deep link fallback (when app was closed)
        // Retry a few times so the SPA/router is definitely ready before forcing
        // navigation.
        try {
            android.net.Uri data = getIntent() != null ? getIntent().getData() : null;
            if (data != null && getBridge() != null && getBridge().getWebView() != null) {
                final String u = data.toString(); // capacitor://localhost/...
                final String path = u.replace("capacitor://localhost", "");

                final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
                final int[] tries = new int[] { 0 };

                Runnable r = new Runnable() {
                    @Override
                    public void run() {
                        tries[0] += 1;
                        try {
                            // If WebView isn't initialized enough yet, retry briefly
                            if (getBridge() == null || getBridge().getWebView() == null) {
                                if (tries[0] < 10)
                                    h.postDelayed(this, 120);
                                return;
                            }

                            getBridge().getWebView().evaluateJavascript(
                                    "window.location.href = " + org.json.JSONObject.quote(path) + ";",
                                    null);
                        } catch (Exception ignored2) {
                        }

                        // Retry a few times to survive slow cold-starts
                        if (tries[0] < 5)
                            h.postDelayed(this, 180);
                    }
                };

                h.postDelayed(r, 120);
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

        // ✅ HARD fallback: force the WebView route (with retry, to survive slow router
        // load)
        try {
            android.net.Uri data = intent != null ? intent.getData() : null;
            if (data != null) {
                final String u = data.toString(); // e.g. capacitor://localhost/browse?call=1...
                final String path = u.replace("capacitor://localhost", "");

                final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
                final int[] tries = new int[] { 0 };

                Runnable r = new Runnable() {
                    @Override
                    public void run() {
                        tries[0] += 1;
                        try {
                            if (getBridge() == null || getBridge().getWebView() == null) {
                                if (tries[0] < 10)
                                    h.postDelayed(this, 120);
                                return;
                            }

                            getBridge().getWebView().evaluateJavascript(
                                    "window.location.href = " + org.json.JSONObject.quote(path) + ";",
                                    null);
                        } catch (Exception ignored2) {
                        }

                        if (tries[0] < 5)
                            h.postDelayed(this, 180);
                    }
                };

                h.postDelayed(r, 60);
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