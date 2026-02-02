//apps/web/android/app/src/main/java/touch/kpocha/app/NotifStatusPlugin.java
package touch.kpocha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

@CapacitorPlugin(name = "NotifStatus")
public class NotifStatusPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        boolean appEnabled = false;
        boolean callsEnabled = false;

        try {
            NotificationManagerCompat nmc = NotificationManagerCompat.from(getContext());
            appEnabled = nmc.areNotificationsEnabled();

            // Default: if app notifications enabled, assume calls enabled too (pre-26)
            callsEnabled = appEnabled;

            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getContext()
                        .getSystemService(android.content.Context.NOTIFICATION_SERVICE);

                if (nm != null) {
                    NotificationChannel ch = nm.getNotificationChannel(CallNotification.CHANNEL_ID); // "calls"
                    if (ch != null) {
                        callsEnabled = (ch.getImportance() != NotificationManager.IMPORTANCE_NONE);
                    } else {
                        // channel not created yet -> treat as enabled if app notifications enabled
                        callsEnabled = appEnabled;
                    }
                }
            }
        } catch (Exception ignored) {
        }

        JSObject ret = new JSObject();
        ret.put("appEnabled", appEnabled);
        ret.put("callsEnabled", callsEnabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            }

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }

        call.resolve();
    }
}
