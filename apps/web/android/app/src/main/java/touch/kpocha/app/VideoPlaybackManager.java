//apps/web/android/app/src/main/java/touch/kpocha/app/VideoPlaybackManager.java
package touch.kpocha.app;

import android.content.Context;
import android.net.Uri;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.ui.PlayerView;

public class VideoPlaybackManager {
    private static final VideoPlaybackManager INSTANCE = new VideoPlaybackManager();

    private ExoPlayer player;
    private PlayerView attachedView;
    private String currentUrl;
    private boolean muted = true;

    public static VideoPlaybackManager get() {
        return INSTANCE;
    }

    public void ensure(Context ctx) {
        if (player != null)
            return;
        player = new ExoPlayer.Builder(ctx.getApplicationContext()).build();
        player.setRepeatMode(com.google.android.exoplayer2.Player.REPEAT_MODE_ONE);
        setMuted(true);
    }

    public void attach(PlayerView view) {
        if (view == null)
            return;
        attachedView = view;
        attachedView.setPlayer(player);
    }

    public void detach(PlayerView view) {
        if (view == null)
            return;
        if (attachedView == view) {
            attachedView.setPlayer(null);
            attachedView = null;
        }
    }

    public void play(Context ctx, String url, PlayerView view) {
        if (url == null || url.trim().isEmpty())
            return;
        ensure(ctx);
        attach(view);

        if (!url.equals(currentUrl)) {
            currentUrl = url;
            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            player.prepare();
        }
        player.play();
    }

    public void pause() {
        if (player != null)
            player.pause();
    }

    public void stop() {
        if (player != null) {
            player.pause();
            player.stop();
        }
        currentUrl = null;
    }

    public void setMuted(boolean on) {
        muted = on;
        if (player != null)
            player.setVolume(on ? 0f : 1f);
    }

    public boolean isMuted() {
        return muted;
    }

    public void release() {
        if (player != null) {
            try {
                player.release();
            } catch (Exception ignored) {
            }
        }
        player = null;
        attachedView = null;
        currentUrl = null;
    }
}
