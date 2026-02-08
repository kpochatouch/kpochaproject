//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedPlugin.java
package touch.kpocha.app;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeFeed")
public class NativeFeedPlugin extends Plugin {
    private static final String TAG = "NativeFeedPlugin";

    @PluginMethod
    public void open(PluginCall call) {
        try {
            String apiBase = call.getString("apiBase", "");
            String lga = call.getString("lga", "");
            String token = call.getString("token", ""); // optional
            String startPostId = call.getString("startPostId", "");
            int startIndex = call.getInt("startIndex", -1);

            Log.d(TAG, "open() called. apiBase=" + apiBase + " lga=" + lga + " hasToken=" + (!token.isEmpty()));

            Intent i = new Intent(getActivity(), NativeFeedActivity.class);
            i.putExtra(NativeFeedActivity.EXTRA_API_BASE, apiBase);
            i.putExtra(NativeFeedActivity.EXTRA_LGA, lga);
            i.putExtra(NativeFeedActivity.EXTRA_TOKEN, token);
            i.putExtra(NativeFeedActivity.EXTRA_START_POST_ID, startPostId);
            i.putExtra(NativeFeedActivity.EXTRA_START_INDEX, startIndex);

            // Use Activity context (correct) — do NOT force NEW_TASK
            getActivity().startActivity(i);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "open() failed", e);
            call.reject("NativeFeed open failed", e);
        }

    }
}
