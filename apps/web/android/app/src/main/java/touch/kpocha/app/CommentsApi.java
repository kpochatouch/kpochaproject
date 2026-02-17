//apps/web/android/app/src/main/java/touch/kpocha/app/CommentsApi.java
package touch.kpocha.app;

import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class CommentsApi {

    private static final OkHttpClient client = new OkHttpClient();
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    public interface ListCallback {
        void onSuccess(List<CommentItem> items);

        void onError(String message);
    }

    public interface CreateCallback {
        void onSuccess(CommentItem created);

        void onError(String message);
    }

    public static void fetchComments(String apiBase, String postId, String token, ListCallback cb) {
        try {
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId)) {
                cb.onError("Missing params");
                return;
            }

            String root = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
            String url = root + "/api/posts/" + postId + "/comments";

            Request.Builder b = new Request.Builder().url(url).get();
            if (!TextUtils.isEmpty(token))
                b.header("Authorization", "Bearer " + token);

            client.newCall(b.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    cb.onError("Network error");
                }

                @Override
                public void onResponse(Call call, Response resp) throws IOException {
                    if (!resp.isSuccessful()) {
                        try {
                            if (resp.body() != null)
                                resp.body().close();
                        } catch (Exception ignored) {
                        }
                        cb.onError("HTTP " + resp.code());
                        return;
                    }

                    String body = "[]";
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
                        JSONArray arr = new JSONArray(body);
                        List<CommentItem> out = new ArrayList<>();

                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject c = arr.optJSONObject(i);
                            if (c == null)
                                continue;

                            CommentItem it = new CommentItem();
                            it.id = c.optString("_id", "");
                            it.postId = c.optString("postId", "");
                            it.text = c.optString("text", "");
                            it.createdAt = c.optString("createdAt", "");
                            it.authorName = c.optString("authorName", "");
                            it.authorAvatar = c.optString("authorAvatar", "");
                            out.add(it);
                        }

                        cb.onSuccess(out);
                    } catch (Exception e) {
                        cb.onError("Parse error");
                    }
                }
            });

        } catch (Exception e) {
            cb.onError("Parse error");
        }
    }

    public static void createComment(String apiBase, String postId, String token, String text, CreateCallback cb) {
        try {
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId)) {
                cb.onError("Missing params");
                return;
            }
            if (TextUtils.isEmpty(token)) {
                cb.onError("Login required");
                return;
            }

            String root = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
            String url = root + "/api/posts/" + postId + "/comments";

            JSONObject payload = new JSONObject();
            payload.put("text", String.valueOf(text == null ? "" : text).trim());

            RequestBody rb = RequestBody.create(JSON, payload.toString());

            Request req = new Request.Builder()
                    .url(url)
                    .post(rb)
                    .header("Authorization", "Bearer " + token)
                    .build();

            client.newCall(req).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    cb.onError("Network error");
                }

                @Override
                public void onResponse(Call call, Response resp) throws IOException {
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

                    if (!resp.isSuccessful()) {
                        cb.onError("HTTP " + resp.code());
                        return;
                    }

                    try {
                        JSONObject o = new JSONObject(body);
                        JSONObject c = o.optJSONObject("comment");
                        if (c == null)
                            throw new Exception("missing comment");

                        CommentItem it = new CommentItem();
                        it.id = c.optString("_id", "");
                        it.postId = c.optString("postId", postId);
                        it.text = c.optString("text", "");
                        it.createdAt = c.optString("createdAt", "");
                        it.authorName = c.optString("authorName", "");
                        it.authorAvatar = c.optString("authorAvatar", "");
                        cb.onSuccess(it);
                    } catch (Exception e) {
                        cb.onError("Parse error");
                    }
                }
            });

        } catch (Exception e) {
            cb.onError("Parse error");
        }
    }
}
