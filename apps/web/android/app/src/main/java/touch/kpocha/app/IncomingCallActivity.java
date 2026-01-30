//app/web/android/app/src/main/java/touch/kpocha/app/IncomingCallActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {

  private String callId;
  private String room;
  private String callType;
  private String fromName;
  private String fromAvatar;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    callId = getIntent().getStringExtra("callId");
    room = getIntent().getStringExtra("room");
    callType = getIntent().getStringExtra("callType");
    fromName = getIntent().getStringExtra("fromName");
    fromAvatar = getIntent().getStringExtra("fromAvatar");

    // Show over lockscreen + turn screen on
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
      KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
      if (km != null)
        km.requestDismissKeyguard(this, null);
    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
              WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    setContentView(R.layout.activity_incoming_call);

    TextView title = findViewById(R.id.callTitle);
    Button accept = findViewById(R.id.btnAccept);
    Button decline = findViewById(R.id.btnDecline);

    String label = (fromName != null && !fromName.isEmpty()) ? fromName : "Someone";
    title.setText(label + " is calling…");

    accept.setOnClickListener(v -> {
      CallNotification.cancel(this);
      Intent stop = new Intent(this, CallForegroundService.class);
      stop.setAction(CallForegroundService.ACTION_STOP);
      startService(stop);

      openCallRoute();

      // ✅ give MainActivity time to come to front before we close this screen
      new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
        try {
          finish();
        } catch (Exception ignored) {
        }
      }, 400);
    });

    decline.setOnClickListener(v -> {
      CallNotification.cancel(this);
      Intent stop = new Intent(this, CallForegroundService.class);
      stop.setAction(CallForegroundService.ACTION_STOP);
      startService(stop);

      finish();
    });
  }

  private void openCallRoute() {
    // This matches your existing JS handler in App.jsx:
    // /browse?call=1&callId=...&room=...&callType=...
    String url = "capacitor://localhost/browse?call=1&accept=1"
        + "&fromName=" + enc(fromName)
        + "&fromAvatar=" + enc(fromAvatar)
        + "&callId=" + enc(callId)
        + "&room=" + enc(room)
        + "&callType=" + enc(callType);

    Intent i = new Intent(this, MainActivity.class);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    i.setData(android.net.Uri.parse(url));
    startActivity(i);
  }

  private String enc(String s) {
    try {
      if (s == null)
        return "";
      return java.net.URLEncoder.encode(s, "UTF-8");
    } catch (Exception e) {
      return s == null ? "" : s;
    }
  }

}
