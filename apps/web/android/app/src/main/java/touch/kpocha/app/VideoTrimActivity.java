//apps/web/android/app/src/main/java/touch/kpocha/app/VideoTrimActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.google.android.material.slider.RangeSlider;

import java.io.File;
import java.util.List;

import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;

@UnstableApi
public class VideoTrimActivity extends Activity {

    public static final String EXTRA_INPUT_URI = "inputUri";
    public static final String EXTRA_OUTPUT_URI = "outputUri";
    public static final String EXTRA_MAX_SECONDS = "maxSeconds";

    private Uri inputUri;
    private int maxSeconds = 30;

    private RangeSlider slider;
    private TextView btnDone;
    private TextView status;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_video_trim);

        String in = getIntent().getStringExtra(EXTRA_INPUT_URI);
        maxSeconds = getIntent().getIntExtra(EXTRA_MAX_SECONDS, 30);

        slider = findViewById(R.id.trimSlider);
        btnDone = findViewById(R.id.btnDone);
        status = findViewById(R.id.status);

        if (TextUtils.isEmpty(in)) {
            setStatus("Missing input uri");
            finish();
            return;
        }

        inputUri = Uri.parse(in);

        slider.setValueFrom(0f);
        slider.setValueTo((float) maxSeconds);
        slider.setValues(0f, (float) maxSeconds);

        btnDone.setOnClickListener(v -> exportTrim());
    }

    private void exportTrim() {
        List<Float> vals = slider.getValues();
        float startS = vals.get(0);
        float endS = vals.get(1);

        if (endS <= startS) {
            setStatus("Invalid range");
            return;
        }

        long startMs = (long) (startS * 1000f);
        long endMs = (long) (endS * 1000f);

        setStatus("Exporting…");

        try {
            File outFile = new File(getCacheDir(), "story_trim_" + System.currentTimeMillis() + ".mp4");
            String outPath = outFile.getAbsolutePath();

            MediaItem item = new MediaItem.Builder()
                    .setUri(inputUri)
                    .setClippingConfiguration(
                            new MediaItem.ClippingConfiguration.Builder()
                                    .setStartPositionMs(startMs)
                                    .setEndPositionMs(endMs)
                                    .build())
                    .build();

            EditedMediaItem edited = new EditedMediaItem.Builder(item).build();

            Transformer transformer = new Transformer.Builder(this)
                    .addListener(new Transformer.Listener() {
                        @Override
                        public void onCompleted(
                                androidx.media3.transformer.Composition composition,
                                ExportResult exportResult) {
                            Intent r = new Intent();
                            r.putExtra(EXTRA_OUTPUT_URI, Uri.fromFile(outFile).toString());
                            setResult(RESULT_OK, r);
                            finish();
                        }

                        @Override
                        public void onError(
                                androidx.media3.transformer.Composition composition,
                                ExportResult exportResult,
                                ExportException exportException) {
                            setStatus("Export failed: " + exportException.getMessage());
                        }
                    })
                    .build();

            transformer.start(edited, outPath);

        } catch (Exception e) {
            setStatus("Export failed: " + e.getMessage());
        }
    }

    private void setStatus(String s) {
        if (status != null)
            status.setText(s != null ? s : "");
    }
}
