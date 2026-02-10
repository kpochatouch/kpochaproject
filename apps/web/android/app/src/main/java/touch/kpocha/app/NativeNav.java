//apps/web/android/app/src/main/java/touch/kpocha/app/NativeNav.java
package touch.kpocha.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

public class NativeNav {

    public static void open(Activity a, String path) {
        try {
            if (a == null)
                return;
            String p = (path == null || path.trim().isEmpty()) ? "/browse" : path.trim();
            if (!p.startsWith("/"))
                p = "/" + p;

            // ✅ Use your existing MainActivity fallback handler (capacitor://localhost/...)
            Uri uri = Uri.parse("capacitor://localhost" + p);

            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.setClass(a, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            a.startActivity(i);
        } catch (Exception ignored) {
        }
    }
}
