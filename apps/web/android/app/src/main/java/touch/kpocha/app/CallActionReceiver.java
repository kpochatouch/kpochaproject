package touch.kpocha.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    if (ctx == null || intent == null) return;

    String action = intent.getAction();

    if (CallNotification.ACTION_ACCEPT.equals(action)) {
      // 1) stop the foreground ringing + notification immediately
      try {
        CallNotification.cancel(ctx);
      } catch (Exception ignored) {
      }
      try {
        ctx.stopService(new Intent(ctx, CallForegroundService.class));
      } catch (Exception ignored) {
      }

      // 2) Go DIRECTLY to the web CallSheet via deep link (no native IncomingCallActivity hop)
      String fromName = intent.getStringExtra("fromName");
      String fromAvatar = intent.getStringExtra("fromAvatar");
      String callId = intent.getStringExtra("callId");
      String room = intent.getStringExtra("room");
      String callType = intent.getStringExtra("callType");

      String url =
          "capacitor://localhost/browse?call=1&accept=1"
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
      open.setData(android.net.Uri.parse(url));

      ctx.startActivity(open);
      return;
    }

    if (CallNotification.ACTION_DECLINE.equals(action)) {
      try {
        CallNotification.cancel(ctx);
      } catch (Exception ignored) {
      }
      try {
        ctx.stopService(new Intent(ctx, CallForegroundService.class));
      } catch (Exception ignored) {
      }
    }
  }

  private static String safeEnc(String s) {
    try {
      if (s == null) return "";
      return java.net.URLEncoder.encode(s, "UTF-8");
    } catch (Exception e) {
      return s == null ? "" : s;
    }
  }
}
