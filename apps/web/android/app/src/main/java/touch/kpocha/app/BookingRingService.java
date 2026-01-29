//app/web/android/app/src/main/java/touch/kpocha/app/BookingRingService.java
package touch.kpocha.app;

import android.app.Service;
import android.content.Intent;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;

public class BookingRingService extends Service {
    private MediaPlayer player;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String bookingId = intent.getStringExtra("bookingId");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");

        int ringSeconds = 20; // default
        try {
            ringSeconds = Integer.parseInt(String.valueOf(intent.getStringExtra("ringSeconds")));
        } catch (Exception ignored) {
        }

        // Foreground notification (heads-up + actions)
        startForeground(
                BookingNotification.NOTIF_ID,
                BookingNotification.build(this, bookingId, title, body));

        // Start looping ringtone
        startRinging();

        // Auto stop after ringSeconds
        int finalRingSeconds = Math.max(5, Math.min(120, ringSeconds));
        handler.postDelayed(this::stopSelfSafe, finalRingSeconds * 1000L);

        return START_NOT_STICKY;
    }

    private void startRinging() {
        stopRinging();
        try {
            Uri sound = android.provider.Settings.System.DEFAULT_ALARM_ALERT_URI;
            if (sound == null)
                sound = android.provider.Settings.System.DEFAULT_RINGTONE_URI;

            player = new MediaPlayer();
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.setAudioAttributes(
                    new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
            player.prepare();
            player.start();
        } catch (Exception e) {
            // best-effort: if alarm sound fails, don't crash
        }
    }

  private void stopRinging() {
    try {
      if (player != null) {
        if (player.isPlaying()) player.stop();
        player.release();
      }
    } catch (Exception ignored) {
    }
    player = null;
  }

    private void stopSelfSafe() {
        try {
            stopRinging();
            BookingNotification.cancel(this);

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
