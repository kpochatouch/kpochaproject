//app/web/android/app/src/main/java/touch/kpocha/app/BookingActionReceiver.java
package touch.kpocha.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BookingActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        String bookingId = intent.getStringExtra("bookingId");

        // Stop ringing service
        try {
            ctx.stopService(new Intent(ctx, BookingRingService.class));
        } catch (Exception ignored) {
        }

        // Dismiss the foreground notification
        try {
            BookingNotification.cancel(ctx);
        } catch (Exception ignored) {
        }

        if (BookingNotification.ACTION_ACCEPT.equals(action)) {
            // Open booking details (web UI handles Accept)
            String url = "capacitor://localhost/bookings/" + (bookingId == null ? "" : bookingId);
            Intent open = new Intent(ctx, MainActivity.class);
            open.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.setData(android.net.Uri.parse(url));
            try {
                ctx.startActivity(open);
            } catch (Exception ignored) {
            }
            return;
        }

        // Decline: do nothing else (we already stopped ring + dismissed notif)
    }
}
