// apps/web/android/app/src/main/java/touch/kpocha/app/MainActivity.java
package touch.kpocha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null)
                return;

            // Incoming calls: loud + heads-up
            NotificationChannel calls = new NotificationChannel(
                    "calls",
                    "Calls",
                    NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Incoming calls");
            calls.enableVibration(true);
            calls.enableLights(true);
            nm.createNotificationChannel(calls);

            // Alerts: booking/chat/etc
            NotificationChannel alerts = new NotificationChannel(
                    "alerts",
                    "Alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Booking and important alerts");
            alerts.enableVibration(true);
            alerts.enableLights(true);
            nm.createNotificationChannel(alerts);
        }
    }
}
