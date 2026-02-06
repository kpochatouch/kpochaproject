//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;

import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
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

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_feed);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        lga = getIntent().getStringExtra(EXTRA_LGA);
        token = getIntent().getStringExtra(EXTRA_TOKEN);

        recycler = findViewById(R.id.feedRecycler);
        recycler.setLayoutManager(new LinearLayoutManager(this));

        adapter = new NativeFeedAdapter(this, apiBase, token);
        recycler.setAdapter(adapter);

        // Facebook-style: decide which item is "active" while scrolling
        recycler.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(RecyclerView rv, int dx, int dy) {
                super.onScrolled(rv, dx, dy);
                adapter.handleScrollAutoplay(rv);
            }
        });

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
