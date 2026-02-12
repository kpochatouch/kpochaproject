//apps/web/android/app/src/main/java/touch/kpocha/app/StoriesApi.java
package touch.kpocha.app;

import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class StoriesApi {

    public interface StoriesCallback {
        void onSuccess(List<StoryItem> stories);

        void onError(String message);
    }

    private static final OkHttpClient client = new OkHttpClient();

    public static void fetchPublicStories(String apiBase, String token, StoriesCallback cb) {
        try {
            if (TextUtils.isEmpty(apiBase)) {
                cb.onError("Missing apiBase");
                return;
            }

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            String url = root + "/api/stories/public?limit=50";
            Request.Builder b = new Request.Builder().url(url).get();

            // token optional for public stories, but ok to send if present
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
                        List<StoryItem> out = new ArrayList<>();

                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject p = arr.getJSONObject(i);

                            String id = p.optString("_id", p.optString("id", ""));
                            String name = p.optString("authorName", "User");

                            String authorAvatar = p.optString("authorAvatar", "");
                            String thumb = "";

                            JSONArray media = p.optJSONArray("media");
                            if (media != null && media.length() > 0) {
                                JSONObject m0 = media.optJSONObject(0);
                                if (m0 != null) {
                                    String type = m0.optString("type", "");
                                    String thumbUrl = m0.optString("thumbnailUrl", "");
                                    String url0 = m0.optString("url", "");

                                    if (!TextUtils.isEmpty(thumbUrl))
                                        thumb = thumbUrl;
                                    else if ("image".equalsIgnoreCase(type) && !TextUtils.isEmpty(url0))
                                        thumb = url0;
                                }
                            }

                            // final fallback
                            if (TextUtils.isEmpty(thumb))
                                thumb = authorAvatar;

                            out.add(new StoryItem(id, name, thumb));
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
}
