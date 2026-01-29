//app/web/android/app/src/main/java/touch/kpocha/app/CallForegroundService.java
package touch.kpocha.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import androidx.annotation.Nullable;

public class CallForegroundService extends Service {

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String fromName = intent.getStringExtra("fromName");
        String callId = intent.getStringExtra("callId");
        String room = intent.getStringExtra("room");
        String callType = intent.getStringExtra("callType");

        startForeground(
                CallNotification.NOTIF_ID,
                CallNotification.buildIncoming(this, fromName, callId, room, callType));
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
