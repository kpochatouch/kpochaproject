// apps/web/android/app/src/main/java/touch/kpocha/app/VideoPlaybackManager.java
package touch.kpocha.app;

import android.content.Context;
import android.net.Uri;

import java.util.HashMap;
import java.util.Map;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

public class VideoPlaybackManager {
    private static final VideoPlaybackManager INSTANCE = new VideoPlaybackManager();

    private static final String PREFS = "kpocha_prefs";
    private static final String KEY_MUTED = "feed_muted";

    private ExoPlayer player;
    private PlayerView attachedView;
    private String currentUrl;

    private boolean muted = true;
    private Context appCtx;

    public interface FirstFrameListener {
        void onFirstFrame(String url);
    }

    private final Map<String, FirstFrameListener> firstFrameByUrl = new HashMap<>();

    public static VideoPlaybackManager get() {
        return INSTANCE;
    }

    public void onFirstFrameForUrl(String url, FirstFrameListener cb) {
        if (url == null || url.trim().isEmpty() || cb == null)
            return;
        firstFrameByUrl.put(url, cb);
    }

    public void ensure(Context ctx) {
        if (player != null)
            return;

        appCtx = ctx.getApplicationContext();

        player = new ExoPlayer.Builder(appCtx).build();
        player.setRepeatMode(Player.REPEAT_MODE_ONE);

        player.addListener(new Player.Listener() {
            @Override
            public void onRenderedFirstFrame() {
                try {
                    if (currentUrl != null) {
                        FirstFrameListener cb = firstFrameByUrl.remove(currentUrl);
                        if (cb != null)
                            cb.onFirstFrame(currentUrl);
                    }
                } catch (Exception ignored) {
                }
            }
        });

        boolean savedMuted = true;
        try {
            savedMuted = appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean(KEY_MUTED, true);
        } catch (Exception ignored) {
        }

        setMuted(savedMuted);
    }

    public void attach(PlayerView view) {
        if (view == null)
            return;
        ensure(view.getContext());

        if (attachedView != null && attachedView != view) {
            try {
                attachedView.setPlayer(null);
            } catch (Exception ignored) {
            }
        }

        attachedView = view;
        attachedView.setPlayer(player);
    }

    public void detach(PlayerView view) {
        if (view == null)
            return;
        if (attachedView == view) {
            try {
                attachedView.setPlayer(null);
            } catch (Exception ignored) {
            }
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

        player.setVolume(muted ? 0f : 1f);
        player.play();
    }

    public void toggleMuted() {
        if (player == null && appCtx != null)
            ensure(appCtx);
        setMuted(!muted);
    }

    public void setMuted(boolean on) {
        muted = on;
        if (player != null)
            player.setVolume(on ? 0f : 1f);

        try {
            if (appCtx != null) {
                appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean(KEY_MUTED, on)
                        .apply();
            }
        } catch (Exception ignored) {
        }
    }

    public boolean isMuted() {
        return muted;
    }

    public boolean isPlaying() {
        return player != null && player.isPlaying();
    }

    /**
     * Facebook-style reels:
     * - when playing: unmuted
     * - when paused: muted
     */
    public void setPlayingReelsStyle(boolean play) {
        if (player == null)
            return;
        if (play) {
            setMuted(false);
            player.play();
        } else {
            player.pause();
            setMuted(true);
        }
    }

    public void togglePlayPause() {
        if (player == null)
            return;
        if (player.isPlaying())
            player.pause();
        else
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
        appCtx = null;
        firstFrameByUrl.clear();
    }
}
