//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;

import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

import android.content.Intent;
import android.util.Log;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.google.android.material.bottomnavigation.BottomNavigationView;

public class NativeFeedActivity extends Activity {

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_LGA = "lga";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_START_POST_ID = "startPostId";
    public static final String EXTRA_START_INDEX = "startIndex";

    private RecyclerView recycler;
    private NativeFeedAdapter adapter;

    private String apiBase;
    private String lga;
    private String token;
    private String startPostId;
    private int startIndex;

    private BottomNavigationView bottomNav;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable hideNavRunnable = this::hideNav;
    private boolean navVisible = false;

    private static final int AUTO_HIDE_MS = 1800;
    private static final int ANIM_MS = 180;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_feed);
        Log.d("NativeFeedActivity", "onCreate()");

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        if (apiBase == null || apiBase.trim().isEmpty()) {
            apiBase = BuildConfig.API_BASE;
        }

        lga = getIntent().getStringExtra(EXTRA_LGA);
        token = getIntent().getStringExtra(EXTRA_TOKEN);

        startPostId = getIntent().getStringExtra(EXTRA_START_POST_ID);
        startIndex = getIntent().getIntExtra(EXTRA_START_INDEX, -1);
        recycler = findViewById(R.id.feedRecycler);

        bottomNav = findViewById(R.id.nativeBottomNav);

        // Create items programmatically (no menu file needed)
        bottomNav.getMenu().add(0, 1, 0, "Discover").setIcon(android.R.drawable.ic_menu_view);
        bottomNav.getMenu().add(0, 2, 1, "Pros").setIcon(android.R.drawable.ic_menu_search);
        bottomNav.getMenu().add(0, 3, 2, "For You").setIcon(android.R.drawable.ic_menu_myplaces);
        bottomNav.getMenu().add(0, 4, 3, "Inbox").setIcon(android.R.drawable.ic_dialog_email);
        bottomNav.getMenu().add(0, 5, 4, "Help").setIcon(android.R.drawable.ic_menu_help);

        // Start hidden after layout
        bottomNav.post(() -> {
            bottomNav.setTranslationY(bottomNav.getHeight());
            navVisible = false;
        });

        bottomNav.setOnItemSelectedListener(item -> {
            showNavTemporarily();

            int id = item.getItemId();
            if (id == 1) {
                // Discover = native feed (already here)
                recycler.smoothScrollToPosition(0);
                return true;
            }
            if (id == 2) {
                openWebRoute("/browse?tab=pros");
                return true;
            }
            if (id == 3) {
                openWebRoute("/for-you");
                return true;
            }
            if (id == 4) {
                openWebRoute("/inbox");
                return true;
            }
            if (id == 5) {
                openWebRoute("/browse");
                return true;
            } // help lives in web for now
            return false;
        });

        // Any touch shows nav temporarily
        recycler.setOnTouchListener((v, e) -> {
            showNavTemporarily();
            return false;
        });

        recycler.setLayoutManager(new LinearLayoutManager(this));

        adapter = new NativeFeedAdapter(this, apiBase, token);
        recycler.setAdapter(adapter);

        // Facebook-style: decide which item is "active" while scrolling
        recycler.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(RecyclerView rv, int newState) {
                super.onScrollStateChanged(rv, newState);

                // Run autoplay decisions when scrolling settles (stable + less spam)
                if (newState == RecyclerView.SCROLL_STATE_IDLE) {
                    adapter.handleScrollAutoplay(rv);
                }
            }

            @Override
            public void onScrolled(RecyclerView rv, int dx, int dy) {
                super.onScrolled(rv, dx, dy);
                showNavTemporarily();

                // Optional: still react during scroll, but lightly (only if user moved
                // meaningfully)
                if (Math.abs(dy) > 12) {
                    adapter.handleScrollAutoplay(rv);
                }
            }
        });

        // Load posts (async)
        PostApi.fetchPublicFeed(apiBase, lga, token, new PostApi.PostsCallback() {
            @Override
            public void onSuccess(List<PostItem> posts) {
                runOnUiThread(() -> {
                    adapter.setItems(posts);

                    recycler.post(() -> {
                        int target = -1;

                        // Prefer startPostId if provided
                        if (startPostId != null && !startPostId.trim().isEmpty()) {
                            target = adapter.findIndexByPostId(startPostId);
                        }

                        // Otherwise use startIndex if provided
                        if (target < 0 && startIndex >= 0 && startIndex < adapter.getItemCount()) {
                            target = startIndex;
                        }

                        if (target >= 0) {
                            recycler.scrollToPosition(target);
                        }

                        adapter.handleScrollAutoplay(recycler);
                    });
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

    private void showNavTemporarily() {
        showNav();
        ui.removeCallbacks(hideNavRunnable);
        ui.postDelayed(hideNavRunnable, AUTO_HIDE_MS);
    }

    private void showNav() {
        if (bottomNav == null)
            return;
        if (navVisible)
            return;
        navVisible = true;
        bottomNav.animate().translationY(0).setDuration(ANIM_MS).start();
    }

    private void hideNav() {
        if (bottomNav == null)
            return;
        if (!navVisible)
            return;
        navVisible = false;
        bottomNav.animate().translationY(bottomNav.getHeight()).setDuration(ANIM_MS).start();
    }

    // Open a WebView route by launching MainActivity with a capacitor://localhost
    // deep link.
    private void openWebRoute(String path) {
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

            i.setData(Uri.parse("capacitor://localhost" + path));
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

}
