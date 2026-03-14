//apps/web/android/app/src/main/java/touch/kpocha/app/StoryComposeActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.widget.TextView;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;

import okhttp3.MediaType;
import okio.BufferedSink;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class StoryComposeActivity extends Activity {

    public static final String EXTRA_API_BASE = "apiBase";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_LGA = "lga";

    private static final int REQ_PICK = 1001;
    private static final int REQ_TRIM = 1002;
    private static final int STORY_MAX_SECONDS = 30;

    private String apiBase;
    private String token;
    private String lga;

    private TextView btnPick;
    private TextView btnPost;
    private TextView status;

    private Uri pickedUri = null;
    private String pickedMime = "";
    private String uploadedAssetId = "";
    private String uploadedType = "";

    private final OkHttpClient client = new OkHttpClient();

    private RequestBody requestBodyFromUri(Uri uri, String mime) {
        return new RequestBody() {
            @Override
            public MediaType contentType() {
                return MediaType.parse(mime != null ? mime : "application/octet-stream");
            }

            @Override
            public long contentLength() throws IOException {
                try {
                    AssetFileDescriptor afd = getContentResolver().openAssetFileDescriptor(uri, "r");
                    if (afd == null)
                        return -1;
                    long len = afd.getLength();
                    afd.close();
                    return len;
                } catch (Exception e) {
                    return -1;
                }
            }

            @Override
            public void writeTo(BufferedSink sink) throws IOException {
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null)
                        throw new IOException("openInputStream returned null");
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        sink.write(buf, 0, n);
                    }
                }
            }
        };
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_story_compose);

        apiBase = getIntent().getStringExtra(EXTRA_API_BASE);
        token = getIntent().getStringExtra(EXTRA_TOKEN);
        lga = getIntent().getStringExtra(EXTRA_LGA);

        btnPick = findViewById(R.id.btnPick);
        btnPost = findViewById(R.id.btnPost);
        status = findViewById(R.id.status);

        if (btnPick != null)
            btnPick.setOnClickListener(v -> pickMedia());

        if (btnPost != null)
            btnPost.setOnClickListener(v -> {
                if (pickedUri == null) {
                    setStatus("Pick a photo or video first.");
                    return;
                }
                if (TextUtils.isEmpty(apiBase) || TextUtils.isEmpty(token)) {
                    setStatus("Missing apiBase/token.");
                    return;
                }

                new Thread(() -> {
                    try {
                        setStatusUi("Uploading...");
                        uploadToBackend();

                        setStatusUi("Posting story...");
                        postStory();

                        setStatusUi("Posted ✅");
                        runOnUiThread(this::finish);
                    } catch (Exception e) {
                        setStatusUi("Failed: " + (e.getMessage() != null ? e.getMessage() : "error"));
                    }
                }).start();
            });
    }

    private void pickMedia() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "video/*" });
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(i, REQ_PICK);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_PICK && resultCode == RESULT_OK && data != null) {
            pickedUri = data.getData();
            if (pickedUri == null)
                return;

            try {
                getContentResolver().takePersistableUriPermission(
                        pickedUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
            }

            pickedMime = getContentResolver().getType(pickedUri);
            uploadedAssetId = "";
            uploadedType = "";

            if (pickedMime != null && pickedMime.startsWith("video/")) {
                Intent t = new Intent(this, VideoTrimActivity.class);
                t.putExtra(VideoTrimActivity.EXTRA_INPUT_URI, pickedUri.toString());
                t.putExtra(VideoTrimActivity.EXTRA_MAX_SECONDS, STORY_MAX_SECONDS);
                startActivityForResult(t, REQ_TRIM);
                setStatus("Picked video — trimming…");
            } else {
                setStatus("Picked: " + (pickedMime != null ? pickedMime : "file"));
            }
            return;
        }

        if (requestCode == REQ_TRIM && resultCode == RESULT_OK && data != null) {
            String out = data.getStringExtra(VideoTrimActivity.EXTRA_OUTPUT_URI);
            if (!TextUtils.isEmpty(out)) {
                pickedUri = Uri.parse(out);
                pickedMime = getContentResolver().getType(pickedUri);
                if (TextUtils.isEmpty(pickedMime))
                    pickedMime = "video/mp4";
                uploadedAssetId = "";
                uploadedType = "";
                setStatus("Trimmed ✓ Ready to upload");
            } else {
                setStatus("Trim failed: missing output");
            }
            return;
        }

        if (requestCode == REQ_TRIM && resultCode != RESULT_OK) {
            setStatus("Trim cancelled.");
        }
    }

    private void uploadToBackend() throws Exception {
        String root = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;

        String mime = !TextUtils.isEmpty(pickedMime) ? pickedMime : "application/octet-stream";
        boolean isVideo = mime.startsWith("video/");
        String type = isVideo ? "video" : "image";

        String filename = guessDisplayName(pickedUri);
        if (TextUtils.isEmpty(filename)) {
            filename = isVideo ? "story.mp4" : "story.jpg";
        }

        // 1) INIT
        String initUrl = root + "/api/media/init";

        JSONObject initPayload = new JSONObject();
        initPayload.put("type", type);
        initPayload.put("contentType", mime);
        initPayload.put("filename", filename);
        initPayload.put("visibility", "public");

        RequestBody initBody = RequestBody.create(
                initPayload.toString().getBytes(),
                MediaType.parse("application/json"));

        Request initReq = new Request.Builder()
                .url(initUrl)
                .post(initBody)
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .build();

        Response initResp = client.newCall(initReq).execute();
        String initRespBody = initResp.body() != null ? initResp.body().string() : "{}";
        if (initResp.body() != null)
            initResp.body().close();

        if (!initResp.isSuccessful()) {
            throw new Exception("media_init_http_" + initResp.code());
        }

        JSONObject initJson = new JSONObject(initRespBody);
        String assetId = initJson.optString("assetId", "");
        String uploadUrl = initJson.optString("uploadUrl", "");

        if (TextUtils.isEmpty(assetId) || TextUtils.isEmpty(uploadUrl)) {
            throw new Exception("media_init_bad_response");
        }

        // 2) DIRECT PUT TO R2
        RequestBody fileBody = requestBodyFromUri(pickedUri, mime);

        Request uploadReq = new Request.Builder()
                .url(uploadUrl)
                .put(fileBody)
                .header("Content-Type", mime)
                .build();

        Response uploadResp = client.newCall(uploadReq).execute();
        try {
            if (!uploadResp.isSuccessful()) {
                throw new Exception("upload_http_" + uploadResp.code());
            }
        } finally {
            if (uploadResp.body() != null) {
                try {
                    uploadResp.body().close();
                } catch (Exception ignored) {
                }
            }
        }

        // 3) COMPLETE
        String completeUrl = root + "/api/media/complete";

        JSONObject completePayload = new JSONObject();
        completePayload.put("assetId", assetId);

        RequestBody completeBody = RequestBody.create(
                completePayload.toString().getBytes(),
                MediaType.parse("application/json"));

        Request completeReq = new Request.Builder()
                .url(completeUrl)
                .post(completeBody)
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .build();

        Response completeResp = client.newCall(completeReq).execute();
        String completeRespBody = completeResp.body() != null ? completeResp.body().string() : "{}";
        if (completeResp.body() != null)
            completeResp.body().close();

        if (!completeResp.isSuccessful()) {
            throw new Exception("media_complete_http_" + completeResp.code());
        }

        JSONObject completeJson = new JSONObject(completeRespBody);
        if (!completeJson.optBoolean("ok", false)) {
            throw new Exception("media_complete_failed");
        }

        uploadedAssetId = assetId;
        uploadedType = type;
    }

    private void postStory() throws Exception {
        String root = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
        String url = root + "/api/stories";

        if (TextUtils.isEmpty(uploadedAssetId) || TextUtils.isEmpty(uploadedType)) {
            throw new Exception("missing_uploaded_asset");
        }

        JSONObject payload = new JSONObject();
        payload.put("text", "");
        payload.put("lga", lga != null ? lga : "");
        payload.put("isPublic", true);

        JSONArray media = new JSONArray();
        JSONObject m0 = new JSONObject();
        m0.put("assetId", uploadedAssetId);
        m0.put("type", uploadedType);
        media.put(m0);
        payload.put("media", media);

        RequestBody body = RequestBody.create(
                payload.toString().getBytes(),
                MediaType.parse("application/json"));

        Request req = new Request.Builder()
                .url(url)
                .post(body)
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .build();

        Response resp = client.newCall(req).execute();
        String respBody = resp.body() != null ? resp.body().string() : "{}";
        if (resp.body() != null)
            resp.body().close();

        if (!resp.isSuccessful()) {
            throw new Exception("story_http_" + resp.code());
        }

        JSONObject json = new JSONObject(respBody);
        if (!json.optBoolean("ok", false)) {
            throw new Exception("story_create_failed");
        }
    }

    private String guessDisplayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0)
                    return c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private void setStatus(String s) {
        if (status != null)
            status.setText(s != null ? s : "");
    }

    private void setStatusUi(String s) {
        runOnUiThread(() -> setStatus(s));
    }
}
