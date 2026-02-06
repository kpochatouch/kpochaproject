//apps/web/android/app/src/main/java/touch/kpocha/app/NativeVideoPlayerActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.ui.PlayerView;

public class NativeVideoPlayerActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_START_MS = "startMs";
    public static final String EXTRA_MUTED = "muted";
    public static final String EXTRA_LOOP = "loop";

    private ExoPlayer player;
    private PlayerView playerView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // keep screen on while playing
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_native_video_player);
        playerView = findViewById(R.id.playerView);

        final String url = getIntent().getStringExtra(EXTRA_URL);
        final long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0L);
        final boolean muted = getIntent().getBooleanExtra(EXTRA_MUTED, false);
        final boolean loop = getIntent().getBooleanExtra(EXTRA_LOOP, true);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        player.setHandleAudioBecomingNoisy(true);

        if (url != null && url.trim().length() > 0) {
            MediaItem item = MediaItem.fromUri(Uri.parse(url));
            player.setMediaItem(item);
        }

        player.setRepeatMode(loop
                ? com.google.android.exoplayer2.Player.REPEAT_MODE_ONE
                : com.google.android.exoplayer2.Player.REPEAT_MODE_OFF);

        player.setVolume(muted ? 0f : 1f);

        player.prepare();

        if (startMs > 0) {
            player.seekTo(startMs);
        }

        player.play();
    }

    @Override
    protected void onStop() {
        super.onStop();
        try {
            if (player != null) {
                player.pause();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        try {
            if (player != null) {
                player.release();
            }
        } catch (Exception ignored) {
        }
        player = null;
        super.onDestroy();
    }
}
