//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.PagerSnapHelper;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

public class NativeFeedActivity extends Activity {

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_LGA = "lga";
    public static final String EXTRA_TOKEN = "token";

    private RecyclerView recycler;
    private NativeFeedAdapter adapter;

    private String apiBase;
    private String lga;
    private String token;

    private PagerSnapHelper snapHelper = null;
    private LinearLayoutManager layoutManager;
    private View header;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_feed);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        lga = getIntent().getStringExtra(EXTRA_LGA);
        token = getIntent().getStringExtra(EXTRA_TOKEN);

        header = findViewById(R.id.nativeFeedHeader);

        recycler = findViewById(R.id.feedRecycler);
        layoutManager = new LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false);
        recycler.setLayoutManager(layoutManager);

        adapter = new NativeFeedAdapter(this, apiBase, token);
        adapter.setMode(NativeFeedAdapter.Mode.FEED);
        recycler.setAdapter(adapter);

        // autoplay handling while scrolling
        recycler.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(RecyclerView rv, int dx, int dy) {
                super.onScrolled(rv, dx, dy);
                adapter.handleScrollAutoplay(rv);
            }
        });

        // wire header buttons
        TextView btnModeFeed = findViewById(R.id.btnModeFeed);
        TextView btnModeReels = findViewById(R.id.btnModeReels);

        btnModeFeed.setOnClickListener(v -> setMode(NativeFeedAdapter.Mode.FEED));
        btnModeReels.setOnClickListener(v -> setMode(NativeFeedAdapter.Mode.REELS));

        // TODO: wire composer, plus, search, chat to your web routes via deep link if
        // you want.
        // For now they exist as real UI.

        // Load posts
        PostApi.fetchPublicFeed(apiBase, lga, token, new PostApi.PostsCallback() {
            @Override
            public void onSuccess(List<PostItem> posts) {
                runOnUiThread(() -> {
                    adapter.setItems(posts);
                    recycler.post(() -> adapter.handleScrollAutoplay(recycler));
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    View empty = findViewById(R.id.feedEmpty);
                    if (empty != null)
                        empty.setVisibility(View.VISIBLE);
                });
            }
        });
    }

    private void setMode(NativeFeedAdapter.Mode mode) {
        TextView btnModeFeed = findViewById(R.id.btnModeFeed);
        TextView btnModeReels = findViewById(R.id.btnModeReels);

        adapter.setMode(mode);
        if (header != null) {
            header.setVisibility(mode == NativeFeedAdapter.Mode.REELS ? View.GONE : View.VISIBLE);
        }

        int anchor = layoutManager != null ? layoutManager.findFirstVisibleItemPosition() : 0;
        if (anchor == RecyclerView.NO_POSITION)
            anchor = 0;

        if (mode == NativeFeedAdapter.Mode.REELS) {
            // make items full screen + snap like reels
            btnModeFeed.setTextColor(0xFFFFFFFF);
            btnModeFeed.setBackgroundColor(0xFF222222);
            btnModeReels.setTextColor(0xFF000000);
            btnModeReels.setBackgroundColor(0xFFF5C542);

            if (snapHelper == null)
                snapHelper = new PagerSnapHelper();
            try {
                recycler.setOnFlingListener(null);
            } catch (Exception ignored) {
            }
            snapHelper.attachToRecyclerView(recycler);

        } else {
            // normal feed
            btnModeFeed.setTextColor(0xFF000000);
            btnModeFeed.setBackgroundColor(0xFFF5C542);
            btnModeReels.setTextColor(0xFFFFFFFF);
            btnModeReels.setBackgroundColor(0xFF222222);

            // detach snap
            if (snapHelper != null) {
                try {
                    snapHelper.attachToRecyclerView(null);
                } catch (Exception ignored) {
                }
            }
        }

        final int finalAnchor = anchor;
        recycler.post(() -> {
            if (finalAnchor >= 0 && finalAnchor < adapter.getItemCount()) {
                recycler.scrollToPosition(finalAnchor);
            }
            adapter.handleScrollAutoplay(recycler);
        });

    }

    @Override
    protected void onStop() {
        super.onStop();
        VideoPlaybackManager.get().stop();
    }

    @Override
    protected void onDestroy() {
        VideoPlaybackManager.get().release();
        super.onDestroy();
    }
}
