//apps/web/android/app/src/main/java/touch/kpocha/app/PostApi.java
package touch.kpocha.app;

import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class PostApi {

    public interface PostsCallback {
        void onSuccess(List<PostItem> posts);

        void onError(String message);
    }

    private static final OkHttpClient client = new OkHttpClient();

    public static void fetchPublicFeed(String apiBase, String lga, String token, PostsCallback cb) {
        try {
            if (TextUtils.isEmpty(apiBase)) {
                cb.onError("Missing apiBase");
                return;
            }

            String url = apiBase;
            if (url.endsWith("/"))
                url = url.substring(0, url.length() - 1);
            url = url + "/api/posts/public?limit=20";
            if (!TextUtils.isEmpty(lga))
                url = url + "&lga=" + lga;

            Request.Builder b = new Request.Builder().url(url).get();

            // token optional (backend supports guest for /posts/public)
            if (!TextUtils.isEmpty(token)) {
                b.header("Authorization", "Bearer " + token);
            }

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

                        List<PostItem> out = new ArrayList<>();
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject p = arr.getJSONObject(i);

                            PostItem it = new PostItem();
                            it.id = p.optString("_id", p.optString("id", ""));
                            it.authorName = p.optString("authorName", "");
                            it.authorAvatar = p.optString("authorAvatar", "");
                            it.text = p.optString("text", "");
                            it.createdAt = p.optString("createdAt", "");

                            JSONArray media = p.optJSONArray("media");
                            if (media != null && media.length() > 0) {
                                JSONObject m0 = media.optJSONObject(0);
                                if (m0 != null) {
                                    it.mediaUrl = m0.optString("url", "");
                                    it.mediaType = m0.optString("type", "");
                                }
                            }

                            out.add(it);
                        }

                        cb.onSuccess(out);
                    } catch (JSONException je) {
                        cb.onError("Parse error");
                    }

                }
            });
        } catch (Exception e) {
            cb.onError("Parse error");
        }
    }

    public static void sendViewTick(String apiBase, String postId, String token) {
        try {
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId))
                return;

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            String url = root + "/api/posts/" + postId + "/view";

            RequestBody emptyBody = RequestBody.create(new byte[0]);

            Request.Builder b = new Request.Builder()
                    .url(url)
                    .post(emptyBody);

            if (!TextUtils.isEmpty(token)) {
                b.header("Authorization", "Bearer " + token);
            }

            client.newCall(b.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                }

                @Override
                public void onResponse(Call call, Response resp) throws IOException {
                    if (resp.body() != null)
                        resp.body().close();
                }
            });
        } catch (Exception ignored) {
        }
    }

}
