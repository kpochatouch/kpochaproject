//app/web/android/app/src/main/java/touch/kpocha/app/CallActionReceiver.java
package touch.kpocha.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    String action = intent.getAction();

    if (CallNotification.ACTION_ACCEPT.equals(action)) {
      // Launch the full-screen activity (it will route into /browse?call=1...)
      Intent open = new Intent(ctx, IncomingCallActivity.class);
      open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      open.putExtras(intent.getExtras());
      ctx.startActivity(open);
      return;
    }

    if (CallNotification.ACTION_DECLINE.equals(action)) {
      CallNotification.cancel(ctx);
      ctx.stopService(new Intent(ctx, CallForegroundService.class));
    }
  }
}
