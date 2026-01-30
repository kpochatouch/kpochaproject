//app/web/android/app/src/main/java/touch/kpocha/app/CallForegroundService.java
package touch.kpocha.app;

import android.app.Service;
import android.content.Intent;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;

public class CallForegroundService extends Service {
    private MediaPlayer player;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String fromName = intent.getStringExtra("fromName");
        String callId = intent.getStringExtra("callId");
        String room = intent.getStringExtra("room");
        String callType = intent.getStringExtra("callType");

        int ringSeconds = 30; // WhatsApp-like default
        try {
            String rs = intent.getStringExtra("ringSeconds");
            if (rs != null)
                ringSeconds = Integer.parseInt(rs);
        } catch (Exception ignored) {
        }

        // ✅ Ensure calls channel exists (silent channel)
        CallNotification.ensureChannel(this);

        // ✅ Foreground notification (for lockscreen + full screen intent)
        startForeground(
                CallNotification.NOTIF_ID,
                CallNotification.buildIncoming(this, fromName, callId, room, callType));

        // ✅ Loop ringtone ourselves (not notification sound)
        startRinging();

        // ✅ Auto-timeout
        int finalRingSeconds = Math.max(5, Math.min(120, ringSeconds));
        handler.postDelayed(this::stopSelfSafe, finalRingSeconds * 1000L);

        return START_NOT_STICKY;
    }

    private void startRinging() {
        stopRinging();
        try {
            Uri sound = android.provider.Settings.System.DEFAULT_RINGTONE_URI;
            if (sound == null)
                sound = android.provider.Settings.System.DEFAULT_ALARM_ALERT_URI;

            player = new MediaPlayer();
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.setAudioAttributes(
                    new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
            player.prepare();
            player.start();
        } catch (Exception ignored) {
        }
    }

    private void stopRinging() {
        try {
            if (player != null) {
                if (player.isPlaying())
                    player.stop();
                player.release();
            }
        } catch (Exception ignored) {
        }
        player = null;
    }

    private void stopSelfSafe() {
        try {
            stopRinging();
            CallNotification.cancel(this);

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }

        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
