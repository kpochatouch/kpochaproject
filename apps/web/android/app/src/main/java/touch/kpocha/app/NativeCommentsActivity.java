//apps/web/android/app/src/main/java/touch/kpocha/app/NativeCommentsActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

public class NativeCommentsActivity extends Activity {

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_POST_ID = "postId";

    private String apiBase;
    private String token;
    private String postId;

    private RecyclerView recycler;
    private CommentsAdapter adapter;
    private EditText input;
    private View btnSend;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_comments);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        token = getIntent().getStringExtra(EXTRA_TOKEN);
        postId = getIntent().getStringExtra(EXTRA_POST_ID);

        ImageView btnBack = findViewById(R.id.btnBack);
        TextView title = findViewById(R.id.title);
        recycler = findViewById(R.id.commentsRecycler);
        input = findViewById(R.id.commentInput);
        btnSend = findViewById(R.id.btnSend);

        if (title != null)
            title.setText("Comments");
        if (btnBack != null)
            btnBack.setOnClickListener(v -> finish());

        adapter = new CommentsAdapter();
        recycler.setLayoutManager(new LinearLayoutManager(this));
        recycler.setAdapter(adapter);

        loadComments();

        if (btnSend != null) {
            btnSend.setOnClickListener(v -> {
                String text = input != null ? String.valueOf(input.getText()).trim() : "";
                if (TextUtils.isEmpty(text))
                    return;

                CommentsApi.createComment(apiBase, postId, token, text, new CommentsApi.CreateCallback() {
                    @Override
                    public void onSuccess(CommentItem created) {
                        runOnUiThread(() -> {
                            if (input != null)
                                input.setText("");
                            adapter.prepend(created);
                            recycler.scrollToPosition(0);
                        });
                    }

                    @Override
                    public void onError(String message) {
                        runOnUiThread(() -> android.widget.Toast.makeText(NativeCommentsActivity.this,
                                "Failed to comment", android.widget.Toast.LENGTH_SHORT).show());
                    }
                });
            });
        }
    }

    private void loadComments() {
        if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId))
            return;

        CommentsApi.fetchComments(apiBase, postId, token, new CommentsApi.ListCallback() {
            @Override
            public void onSuccess(List<CommentItem> items) {
                runOnUiThread(() -> adapter.setItems(items));
            }

            @Override
            public void onError(String message) {
                // keep empty
            }
        });
    }
}
