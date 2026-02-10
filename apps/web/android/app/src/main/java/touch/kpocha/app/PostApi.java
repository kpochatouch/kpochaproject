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

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            // ✅ IMPORTANT: do NOT filter by lga. Fetch global feed.
            // LGA is preference-only: we will sort locally.
            final String prefLga = (lga == null ? "" : lga.trim().toUpperCase());

            String url = root + "/api/posts/public?limit=40";

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

                            // ✅ best-effort LGA field for preference sorting
                            it.lga = p.optString("lga",
                                    p.optString("ownerLga",
                                            p.optString("locationLga", "")));

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

                        // ✅ preference sort: prefLga matches first, but keep ALL posts
                        if (!TextUtils.isEmpty(prefLga)) {
                            java.util.Collections.sort(out, (a, b2) -> {
                                String la = (a != null && a.lga != null) ? a.lga.trim().toUpperCase() : "";
                                String lb = (b2 != null && b2.lga != null) ? b2.lga.trim().toUpperCase() : "";

                                boolean aMatch = prefLga.equals(la);
                                boolean bMatch = prefLga.equals(lb);

                                if (aMatch && !bMatch)
                                    return -1;
                                if (!aMatch && bMatch)
                                    return 1;

                                // tie-breaker: newest first (string compare works with ISO)
                                String ca = (a != null && a.createdAt != null) ? a.createdAt : "";
                                String cb3 = (b2 != null && b2.createdAt != null) ? b2.createdAt : "";
                                return cb3.compareTo(ca);
                            });
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

    public interface StatsCallback {
        void onSuccess(PostItem updated);

        void onError(String message);
    }

    public static void fetchStats(String apiBase, String postId, String token, StatsCallback cb) {
        try {
            final String bindId = p.id;
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId)) {
                cb.onError("Missing params");
                return;
            }

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            String url = root + "/api/posts/" + postId + "/stats";

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
                        JSONObject s = new JSONObject(body);

                        PostItem it = new PostItem();
                        it.id = postId;

                        it.viewsCount = s.optInt("viewsCount", 0);
                        it.likesCount = s.optInt("likesCount", 0);
                        it.commentsCount = s.optInt("commentsCount", 0);
                        it.sharesCount = s.optInt("sharesCount", 0);

                        it.likedByMe = s.optBoolean("likedByMe", false);

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

    public interface ToggleLikeCallback {
        void onSuccess(boolean likedNow, int likesCount);

        void onError(String message);
    }

    public static void toggleLike(String apiBase, String postId, String token, boolean like, ToggleLikeCallback cb) {
        try {
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId)) {
                cb.onError("Missing params");
                return;
            }

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            String url = root + "/api/posts/" + postId + "/like";

            Request.Builder b = new Request.Builder().url(url);

            if (like) {
                RequestBody emptyBody = RequestBody.create(new byte[0]);
                b.post(emptyBody);
            } else {
                b.delete();
            }

            if (!TextUtils.isEmpty(token))
                b.header("Authorization", "Bearer " + token);

            client.newCall(b.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    cb.onError("Network error");
                }

                @Override
                public void onResponse(Call call, Response resp) throws IOException {
                    // many APIs return updated stats; if not, we'll just return ok
                    String body = "{}";
                    try {
                        if (resp.body() != null)
                            body = resp.body().string();
                    } catch (Exception ignored) {
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

                    int nextLikes = -1;
                    try {
                        JSONObject o = new JSONObject(body);
                        if (o.has("likesCount"))
                            nextLikes = o.optInt("likesCount", -1);
                    } catch (Exception ignored) {
                    }

                    cb.onSuccess(like, nextLikes);
                }
            });

        } catch (Exception e) {
            cb.onError("Parse error");
        }
    }

    public static void sendShareTick(String apiBase, String postId, String token) {
        try {
            if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(postId))
                return;

            String root = apiBase;
            if (root.endsWith("/"))
                root = root.substring(0, root.length() - 1);

            String url = root + "/api/posts/" + postId + "/share";

            RequestBody emptyBody = RequestBody.create(new byte[0]);
            Request.Builder b = new Request.Builder().url(url).post(emptyBody);

            if (!TextUtils.isEmpty(token))
                b.header("Authorization", "Bearer " + token);

            client.newCall(b.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                }

                @Override
                public void onResponse(Call call, Response resp) throws IOException {
                    try {
                        if (resp.body() != null)
                            resp.body().close();
                    } catch (Exception ignored) {
                    }
                }
            });
        } catch (Exception ignored) {
        }
    }

}
