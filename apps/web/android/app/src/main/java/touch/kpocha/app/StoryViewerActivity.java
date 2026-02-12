//apps/web/android/app/src/main/java/touch/kpocha/app/StoryViewerActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.Nullable;

import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class StoryViewerActivity extends Activity {

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_STORY_ID = "storyId";

    private final OkHttpClient client = new OkHttpClient();

    private String apiBase;
    private String token;
    private String storyId;

    private PlayerView playerView;
    private ImageView imageView;
    private TextView btnClose;

    private ExoPlayer player;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_story_viewer);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        token = getIntent().getStringExtra(EXTRA_TOKEN);
        storyId = getIntent().getStringExtra(EXTRA_STORY_ID);

        playerView = findViewById(R.id.playerView);
        imageView = findViewById(R.id.imageView);
        btnClose = findViewById(R.id.btnClose);

        if (btnClose != null)
            btnClose.setOnClickListener(v -> finish());

        if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(storyId)) {
            finish();
            return;
        }

        fetchStoryAndShow();
    }

    private void fetchStoryAndShow() {
        String root = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
        String url = root + "/api/posts/" + storyId; // stories are posts with type=story

        Request.Builder b = new Request.Builder().url(url).get();
        if (!TextUtils.isEmpty(token))
            b.header("Authorization", "Bearer " + token);

        client.newCall(b.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                runOnUiThread(() -> finish());
            }

            @Override
            public void onResponse(Call call, Response resp) throws IOException {
                if (!resp.isSuccessful()) {
                    try {
                        if (resp.body() != null)
                            resp.body().close();
                    } catch (Exception ignored) {
                    }
                    runOnUiThread(() -> finish());
                    return;
                }

                String body = "{}";
                try {
                    if (resp.body() != null)
                        body = resp.body().string();
                } finally {
                    try {
                        if (resp.body() != null)
                            resp.body().close();
                    } catch (Exception ignored) {
                    }
                }

                try {
                    JSONObject p = new JSONObject(body);
                    JSONArray media = p.optJSONArray("media");
                    if (media == null || media.length() == 0) {
                        runOnUiThread(() -> finish());
                        return;
                    }

                    JSONObject m0 = media.optJSONObject(0);
                    if (m0 == null) {
                        runOnUiThread(() -> finish());
                        return;
                    }

                    final String mediaUrl = m0.optString("url", "");
                    final String type = m0.optString("type", "");

                    runOnUiThread(() -> showMedia(mediaUrl, type));
                } catch (Exception e) {
                    runOnUiThread(() -> finish());
                }
            }
        });
    }

    private void showMedia(String url, String type) {
        if (TextUtils.isEmpty(url)) {
            finish();
            return;
        }

        boolean isVideo = "video".equalsIgnoreCase(type) || url.toLowerCase().endsWith(".mp4");

        if (isVideo) {
            imageView.setVisibility(View.GONE);
            playerView.setVisibility(View.VISIBLE);

            player = new ExoPlayer.Builder(this).build();
            playerView.setPlayer(player);

            MediaItem item = MediaItem.fromUri(url);
            player.setMediaItem(item);
            player.setRepeatMode(Player.REPEAT_MODE_ONE);
            player.prepare();
            player.play();
        } else {
            playerView.setVisibility(View.GONE);
            imageView.setVisibility(View.VISIBLE);

            try {
                com.bumptech.glide.Glide.with(this).load(url).into(imageView);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        releasePlayer();
    }

    @Override
    protected void onDestroy() {
        releasePlayer();
        super.onDestroy();
    }

    private void releasePlayer() {
        try {
            if (player != null) {
                player.release();
                player = null;
            }
        } catch (Exception ignored) {
        }
    }
}
