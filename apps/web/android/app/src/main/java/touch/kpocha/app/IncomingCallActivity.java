//app/web/android/app/src/main/java/touch/kpocha/app/IncomingCallActivity.java
package touch.kpocha.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class IncomingCallActivity extends Activity {

  private String callId;
  private String room;
  private String callType;
  private String fromName;
  private String fromAvatar;

  private String chatRoom; // optional: if provided, we try to open that chat

  private float downX = 0;
  private float downY = 0;
  private boolean gestureHandled = false;

  private int SWIPE_PX; // computed at runtime
  private int OFFPATH_PX; // computed at runtime
  private static volatile boolean sAccepting = false;
  private long lastAcceptMs = 0;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    callId = getIntent().getStringExtra("callId");
    room = getIntent().getStringExtra("room");
    callType = getIntent().getStringExtra("callType");
    fromName = getIntent().getStringExtra("fromName");
    fromAvatar = getIntent().getStringExtra("fromAvatar");
    chatRoom = getIntent().getStringExtra("chatRoom");

    // Show over lockscreen + turn screen on
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);

    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
              WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    setContentView(R.layout.activity_incoming_call);
    // Swipe thresholds (in pixels)
    float density = getResources().getDisplayMetrics().density;
    SWIPE_PX = (int) (120f * density); // ~120dp
    OFFPATH_PX = (int) (80f * density); // ~80dp

    ImageView avatarView = findViewById(R.id.callAvatar);

    TextView title = findViewById(R.id.callTitle);
    TextView subtitle = findViewById(R.id.callSubtitle);

    ImageButton accept = findViewById(R.id.btnAcceptRound);

    // ✅ Make swipe-up work when the finger starts on the Accept button
    if (accept != null) {
      accept.setOnTouchListener((v, ev) -> {
        try {
          int action = ev.getActionMasked();
          if (action == MotionEvent.ACTION_DOWN) {
            downX = ev.getRawX();
            downY = ev.getRawY();
            return true;
          }
          if (action == MotionEvent.ACTION_UP) {
            float upX = ev.getRawX();
            float upY = ev.getRawY();
            float dx = upX - downX;
            float dy = upY - downY;

            // Swipe UP = Accept
            if (dy < -SWIPE_PX && Math.abs(dx) < OFFPATH_PX) {
              doAccept();
              return true;
            }

            // Tap = Accept too
            doAccept();
            return true;
          }
        } catch (Exception ignored) {
        }
        return false;
      });
    }

    View arrows = findViewById(R.id.acceptArrows);
    TextView arrow1 = findViewById(R.id.arrow1);
    TextView arrow2 = findViewById(R.id.arrow2);
    TextView arrow3 = findViewById(R.id.arrow3);

    ImageButton decline = findViewById(R.id.btnDeclineRound);
    ImageButton message = findViewById(R.id.btnMessageRound);

    // try load avatar if provided
    loadAvatarInto(avatarView, fromAvatar);

    String label = (fromName != null && !fromName.isEmpty()) ? fromName : "Someone";
    title.setText(label + " is calling…");
    subtitle.setText("Swipe up to accept");
    startDanglingArrows(arrows, arrow1, arrow2, arrow3);

    startDanglingAcceptButton(accept);

    View root = findViewById(android.R.id.content);

    if (root != null) {
      root.setClickable(true);
      root.setFocusable(true);
      root.setFocusableInTouchMode(true);

      root.setOnTouchListener((v, ev) -> {
        try {
          if (gestureHandled)
            return true;

          int action = ev.getActionMasked();
          if (action == MotionEvent.ACTION_DOWN) {
            downX = ev.getX();
            downY = ev.getY();
            return true;
          }

          if (action == MotionEvent.ACTION_UP) {
            float upX = ev.getX();
            float upY = ev.getY();

            float dx = upX - downX;
            float dy = upY - downY;

            // Swipe UP = Accept
            if (dy < -SWIPE_PX && Math.abs(dx) < OFFPATH_PX) {
              gestureHandled = true;
              doAccept();
              return true;
            }

            // Swipe LEFT = Decline
            if (dx < -SWIPE_PX && Math.abs(dy) < OFFPATH_PX) {
              gestureHandled = true;
              doDecline();
              return true;
            }

            // Swipe RIGHT = Message (chat -> inbox fallback)
            if (dx > SWIPE_PX && Math.abs(dy) < OFFPATH_PX) {
              gestureHandled = true;
              doMessage();
              return true;
            }

            return true;
          }
        } catch (Exception ignored) {
        }
        return false;
      });
    }

    // Icon: video icon for video call, phone icon for audio call
    boolean isVideo = "video".equalsIgnoreCase(callType);
    if (accept != null) {
      accept.setImageResource(
          isVideo ? android.R.drawable.presence_video_online : android.R.drawable.sym_action_call);

    }

    if (decline != null) {
      decline.setOnClickListener(v -> doDecline());
    }

    if (message != null) {
      message.setOnClickListener(v -> doMessage());
    }

  }

  private void doAccept() {
    long now = android.os.SystemClock.uptimeMillis();
    if (sAccepting || (now - lastAcceptMs) < 1500) {
      return;
    }
    sAccepting = true;
    lastAcceptMs = now;

    CallNotification.cancel(this);

    Intent stop = new Intent(this, CallForegroundService.class);
    stop.setAction(CallForegroundService.ACTION_STOP);
    stop.putExtra("callId", callId);
    startService(stop);

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km != null)
          km.requestDismissKeyguard(this, null);
      }
    } catch (Exception ignored) {
    }

    openCallRoute();

    // give MainActivity time to come to front before we close this screen
    try {
      finish();
    } catch (Exception ignored) {
    } finally {
      // release debounce after a short delay, but Activity is already gone
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        sAccepting = false;
      }, 600);
    }
  }

  private void doDecline() {
    CallNotification.cancel(this);

    Intent stop = new Intent(this, CallForegroundService.class);
    stop.setAction(CallForegroundService.ACTION_STOP);
    stop.putExtra("callId", callId);
    startService(stop);

    try {
      finish();
    } catch (Exception ignored) {
    }
  }

  private void doMessage() {
    // fallback rule: if chat cannot open, go inbox
    String target = "/inbox";

    if (chatRoom != null && chatRoom.trim().length() > 0) {
      target = "/chat?room=" + enc(chatRoom);
    }

    try {
      String url = "capacitor://localhost" + target;

      Intent i = new Intent(this, MainActivity.class);
      i.setAction(Intent.ACTION_VIEW);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      i.setData(android.net.Uri.parse(url));
      startActivity(i);

      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        try {
          finish();
        } catch (Exception ignored) {
        }
      }, 250);

    } catch (Exception ignored) {
      try {
        String url = "capacitor://localhost/inbox";
        Intent i = new Intent(this, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.setData(android.net.Uri.parse(url));
        startActivity(i);
      } catch (Exception ignored2) {
      }
      try {
        finish();
      } catch (Exception ignored3) {
      }
    }
  }

  private void openCallRoute() {
    // This matches your existing JS handler in App.jsx:
    // /browse?call=1&callId=...&room=...&callType=...
    String url = "capacitor://localhost/browse?call=1"
        + "&fromName=" + enc(fromName)
        + "&fromAvatar=" + enc(fromAvatar)
        + "&callId=" + enc(callId)
        + "&room=" + enc(room)
        + "&callType=" + enc(callType);

    Intent i = new Intent(this, MainActivity.class);
    i.setAction(Intent.ACTION_VIEW);
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

  private void loadAvatarInto(ImageView iv, String url) {
    if (iv == null)
      return;
    if (url == null)
      return;

    final String u = url.trim();
    if (u.length() < 8)
      return; // too short to be real url

    new Thread(() -> {
      InputStream is = null;
      try {
        URL parsed = new URL(u);
        HttpURLConnection conn = (HttpURLConnection) parsed.openConnection();
        conn.setConnectTimeout(4000);
        conn.setReadTimeout(4000);
        conn.setInstanceFollowRedirects(true);
        conn.connect();

        is = conn.getInputStream();
        Bitmap bmp = BitmapFactory.decodeStream(is);
        if (bmp == null)
          return;

        runOnUiThread(() -> {
          try {
            iv.setImageBitmap(bmp);
          } catch (Exception ignored) {
          }
        });
      } catch (Exception ignored) {
        // keep default icon
      } finally {
        try {
          if (is != null)
            is.close();
        } catch (Exception ignored) {
        }
      }
    }).start();
  }

  private void startDanglingArrows(View arrows, TextView a1, TextView a2, TextView a3) {
    try {
      if (arrows == null || a1 == null || a2 == null || a3 == null)
        return;

      // Reset baseline
      arrows.setTranslationY(0f);

      // Move the stack upward repeatedly
      android.animation.ObjectAnimator up = android.animation.ObjectAnimator.ofFloat(arrows, "translationY", 14f, -18f);
      up.setDuration(750);
      up.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      up.setRepeatMode(android.animation.ValueAnimator.RESTART);

      // Fade each arrow with small offsets (looks like motion)
      android.animation.ObjectAnimator f1 = android.animation.ObjectAnimator.ofFloat(a1, "alpha", 0.15f, 0.9f, 0.15f);
      f1.setDuration(750);
      f1.setRepeatCount(android.animation.ValueAnimator.INFINITE);

      android.animation.ObjectAnimator f2 = android.animation.ObjectAnimator.ofFloat(a2, "alpha", 0.15f, 0.9f, 0.15f);
      f2.setDuration(750);
      f2.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      f2.setStartDelay(120);

      android.animation.ObjectAnimator f3 = android.animation.ObjectAnimator.ofFloat(a3, "alpha", 0.15f, 0.9f, 0.15f);
      f3.setDuration(750);
      f3.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      f3.setStartDelay(240);

      up.start();
      f1.start();
      f2.start();
      f3.start();
    } catch (Exception ignored) {
    }
  }

  private void startDanglingAcceptButton(ImageButton accept) {
    try {
      if (accept == null)
        return;

      android.animation.ObjectAnimator bob = android.animation.ObjectAnimator.ofFloat(accept, "translationY", 0f, -14f,
          0f);
      bob.setDuration(850);
      bob.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      bob.setRepeatMode(android.animation.ValueAnimator.RESTART);
      bob.start();
    } catch (Exception ignored) {
    }
  }

}
