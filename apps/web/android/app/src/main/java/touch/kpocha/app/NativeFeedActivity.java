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

import android.content.Intent;
import android.net.Uri;

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

    private RecyclerView storiesRecycler;
    private StoriesAdapter storiesAdapter;
    private int pendingReelsPos = RecyclerView.NO_POSITION;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_feed);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        lga = getIntent().getStringExtra(EXTRA_LGA);
        token = getIntent().getStringExtra(EXTRA_TOKEN);

        header = findViewById(R.id.nativeFeedHeader);

        // ---- Stories (NOT in header; wired here) ----
        storiesRecycler = findViewById(R.id.storiesRecycler);
        if (storiesRecycler != null) {
            storiesRecycler.setLayoutManager(
                    new androidx.recyclerview.widget.LinearLayoutManager(
                            this,
                            androidx.recyclerview.widget.LinearLayoutManager.HORIZONTAL,
                            false));

            storiesAdapter = new StoriesAdapter(this);
            storiesRecycler.setAdapter(storiesAdapter);

            storiesAdapter.setListener(new StoriesAdapter.Listener() {
                @Override
                public void onCreateStory() {
                    Intent i = new Intent(NativeFeedActivity.this, StoryComposeActivity.class);
                    i.putExtra(StoryComposeActivity.EXTRA_API_BASE, apiBase);
                    i.putExtra(StoryComposeActivity.EXTRA_TOKEN, token);
                    i.putExtra(StoryComposeActivity.EXTRA_LGA, lga);
                    startActivity(i);

                }

                @Override
                public void onStoryClicked(StoryItem item) {
                    // later: open story viewer
                    if (item == null || item.id == null || item.id.trim().isEmpty())
                        return;

                    Intent i = new Intent(NativeFeedActivity.this, StoryViewerActivity.class);
                    i.putExtra(StoryViewerActivity.EXTRA_API_BASE, apiBase);
                    i.putExtra(StoryViewerActivity.EXTRA_TOKEN, token);
                    i.putExtra(StoryViewerActivity.EXTRA_STORY_ID, item.id);
                    startActivity(i);
                }
            });

            StoriesApi.fetchPublicStories(apiBase, token, new StoriesApi.StoriesCallback() {
                @Override
                public void onSuccess(java.util.List<StoryItem> stories) {
                    runOnUiThread(() -> storiesAdapter.setItems(stories));
                }

                @Override
                public void onError(String message) {
                    // leave shelf empty silently for now
                }
            });

        }

        recycler = findViewById(R.id.feedRecycler);
        layoutManager = new LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false);
        recycler.setLayoutManager(layoutManager);

        adapter = new NativeFeedAdapter(this, apiBase, token);
        adapter.setMode(NativeFeedAdapter.Mode.FEED);
        recycler.setAdapter(adapter);

        adapter.setListener(new NativeFeedAdapter.Listener() {
            @Override
            public void onRequestReelsAt(int position) {
                pendingReelsPos = position;
                setMode(NativeFeedAdapter.Mode.REELS);
            }

            @Override
            public void onOpenPost(PostItem item) {
                String id = item != null ? item.id : null;
                if (id == null || id.trim().isEmpty()) {
                    android.widget.Toast
                            .makeText(NativeFeedActivity.this, "Missing post id", android.widget.Toast.LENGTH_SHORT)
                            .show();
                    return;
                }
                openWebRoute("/post/" + Uri.encode(id));
            }
        });

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

        TextView btnHamburger = findViewById(R.id.btnHamburger);
        TextView btnPlus = findViewById(R.id.btnPlus);
        TextView btnSearch = findViewById(R.id.btnSearch);
        TextView btnChat = findViewById(R.id.btnChat);

        TextView btnComposer = findViewById(R.id.btnComposer);
        TextView btnPhoto = findViewById(R.id.btnPhoto);

        if (btnHamburger != null)
            btnHamburger.setOnClickListener(v -> NativeNav.open(this, "/browse"));
        if (btnPlus != null)
            btnPlus.setOnClickListener(v -> NativeNav.open(this, "/compose"));
        if (btnSearch != null)
            btnSearch.setOnClickListener(v -> NativeNav.open(this, "/browse?search=1"));
        if (btnChat != null)
            btnChat.setOnClickListener(v -> NativeNav.open(this, "/inbox"));

        if (btnComposer != null)
            btnComposer.setOnClickListener(v -> NativeNav.open(this, "/compose"));
        if (btnPhoto != null)
            btnPhoto.setOnClickListener(v -> NativeNav.open(this, "/compose"));

        btnModeFeed.setOnClickListener(v -> setMode(NativeFeedAdapter.Mode.FEED));
        btnModeReels.setOnClickListener(v -> setMode(NativeFeedAdapter.Mode.REELS));

        View modeToggleRow = findViewById(R.id.modeToggleRow);
        if (modeToggleRow != null)
            modeToggleRow.setVisibility(View.GONE);

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
        if (storiesRecycler != null) {
            storiesRecycler.setVisibility(mode == NativeFeedAdapter.Mode.REELS ? View.GONE : View.VISIBLE);
        }

        int anchor;

        if (mode == NativeFeedAdapter.Mode.REELS && pendingReelsPos != RecyclerView.NO_POSITION) {
            anchor = pendingReelsPos;
        } else {
            anchor = layoutManager != null ? layoutManager.findFirstVisibleItemPosition() : 0;
            if (anchor == RecyclerView.NO_POSITION)
                anchor = 0;
        }

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
            pendingReelsPos = RecyclerView.NO_POSITION;
            adapter.handleScrollAutoplay(recycler);
        });

    }

    @Override
    protected void onResume() {
        super.onResume();
        reloadStories();
    }

    private void reloadStories() {
        if (storiesAdapter == null)
            return;
        StoriesApi.fetchPublicStories(apiBase, token, new StoriesApi.StoriesCallback() {
            @Override
            public void onSuccess(java.util.List<StoryItem> stories) {
                runOnUiThread(() -> storiesAdapter.setItems(stories));
            }

            @Override
            public void onError(String message) {
                // ignore
            }
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

    private void openWebRoute(String path) {
        try {
            if (path == null)
                path = "/browse";
            if (!path.startsWith("/"))
                path = "/" + path;

            Intent i = new Intent(this, MainActivity.class);
            i.setAction(Intent.ACTION_VIEW);
            i.setData(Uri.parse("capacitor://localhost" + path));
            i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
        } catch (Exception e) {
            android.widget.Toast.makeText(this, "Failed to open route", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

}
