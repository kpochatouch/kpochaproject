//apps/web/android/app/src/main/java/touch/kpocha/app/CallActionReceiver.java
package touch.kpocha.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    if (ctx == null || intent == null)
      return;

    String action = intent.getAction();

    if (CallNotification.ACTION_ACCEPT.equals(action)) {
      String callId = intent.getStringExtra("callId");

      // 1) stop the foreground ringing + notification immediately
      try {
        CallNotification.cancel(ctx);
      } catch (Exception ignored) {
      }

      // ✅ Stop service the supported way (also clears CallSession via callId)
      try {
        Intent stop = new Intent(ctx, CallForegroundService.class);
        stop.setAction(CallForegroundService.ACTION_STOP);
        stop.putExtra("callId", callId);
        ctx.startService(stop);
      } catch (Exception ignored) {
      }

      // 2) Go DIRECTLY to the web CallSheet via deep link (no native
      // IncomingCallActivity hop)
      String fromName = intent.getStringExtra("fromName");
      String fromAvatar = intent.getStringExtra("fromAvatar");
      String room = intent.getStringExtra("room");
      String callType = intent.getStringExtra("callType");

      String url = "capacitor://localhost/browse?call=1"

          + "&fromName=" + safeEnc(fromName)
          + "&fromAvatar=" + safeEnc(fromAvatar)
          + "&callId=" + safeEnc(callId)
          + "&room=" + safeEnc(room)
          + "&callType=" + safeEnc(callType);

      Intent open = new Intent(ctx, MainActivity.class);
      open.setAction(Intent.ACTION_VIEW);
      open.addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK
              | Intent.FLAG_ACTIVITY_SINGLE_TOP
              | Intent.FLAG_ACTIVITY_CLEAR_TOP);

      // ✅ make intent identity unique per call (prevents stale intent reuse)
      try {
        open.setData(android.net.Uri.parse(url + "&_ts=" + System.currentTimeMillis()));
      } catch (Exception ignored) {
        open.setData(android.net.Uri.parse(url));
      }

      ctx.startActivity(open);
      return;
    }

    if (CallNotification.ACTION_DECLINE.equals(action)) {
      String callId = intent.getStringExtra("callId");

      try {
        CallNotification.cancel(ctx);
      } catch (Exception ignored) {
      }

      // ✅ stop service the supported way (also clears by callId)
      try {
        Intent stop = new Intent(ctx, CallForegroundService.class);
        stop.setAction(CallForegroundService.ACTION_STOP);
        stop.putExtra("callId", callId);
        ctx.startService(stop);
      } catch (Exception ignored) {
      }

      return;
    }
  }

  private static String safeEnc(String s) {
    try {
      if (s == null)
        return "";
      return java.net.URLEncoder.encode(s, "UTF-8");
    } catch (Exception e) {
      return s == null ? "" : s;
    }
  }
}
