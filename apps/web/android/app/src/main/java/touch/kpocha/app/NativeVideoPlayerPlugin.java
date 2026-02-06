//apps/web/android/app/src/main/java/touch/kpocha/app/NativeVideoPlayerPlugin.java
package touch.kpocha.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeVideoPlayer")
public class NativeVideoPlayerPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        try {
            String url = call.getString("url", "");
            long startMs = call.getLong("startMs", 0L);
            boolean muted = call.getBoolean("muted", false);
            boolean loop = call.getBoolean("loop", true);

            if (url == null || url.trim().isEmpty()) {
                call.reject("Missing url");
                return;
            }

            Intent i = new Intent(getContext(), NativeVideoPlayerActivity.class);
            i.putExtra(NativeVideoPlayerActivity.EXTRA_URL, url);
            i.putExtra(NativeVideoPlayerActivity.EXTRA_START_MS, startMs);
            i.putExtra(NativeVideoPlayerActivity.EXTRA_MUTED, muted);
            i.putExtra(NativeVideoPlayerActivity.EXTRA_LOOP, loop);

            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("open failed", e);
        }
    }
}
