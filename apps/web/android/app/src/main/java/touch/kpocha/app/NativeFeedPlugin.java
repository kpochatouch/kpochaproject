//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedPlugin.java
package touch.kpocha.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeFeed")
public class NativeFeedPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        try {
            String apiBase = call.getString("apiBase", "");
            String lga = call.getString("lga", "");
            String token = call.getString("token", ""); // optional

            // ✅ new: scroll + start mode
            String postId = call.getString("postId", "");
            String startMode = call.getString("startMode", "feed"); // "feed" or "reels"

            android.util.Log.i("NativeFeedPlugin",
                    "open() called apiBase=" + apiBase
                            + " lga=" + lga
                            + " token?=" + (!token.isEmpty())
                            + " postId?=" + (!postId.isEmpty())
                            + " startMode=" + startMode);

            Intent i = new Intent(getContext(), NativeFeedActivity.class);
            i.putExtra(NativeFeedActivity.EXTRA_API_BASE, apiBase);
            i.putExtra(NativeFeedActivity.EXTRA_LGA, lga);
            i.putExtra(NativeFeedActivity.EXTRA_TOKEN, token);

            // ✅ start at tapped post
            i.putExtra(NativeFeedActivity.EXTRA_START_POST_ID, postId);
            i.putExtra(NativeFeedActivity.EXTRA_START_MODE, startMode);

            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("NativeFeed open failed", e);
        }
    }
}
