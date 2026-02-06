//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedAdapter.java
package touch.kpocha.app;

import android.app.Activity;
import android.graphics.Rect;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import com.google.android.exoplayer2.ui.PlayerView;

import java.util.ArrayList;
import java.util.List;

public class NativeFeedAdapter extends RecyclerView.Adapter<NativeFeedAdapter.VH> {

    private final List<PostItem> items = new ArrayList<>();
    private final Activity activity;
    private final String apiBase;
    private final String token;

    private String lastViewedPostId = null;
    private int activePos = RecyclerView.NO_POSITION;

    public NativeFeedAdapter(Activity activity, String apiBase, String token) {
        this.activity = activity;
        this.apiBase = apiBase;
        this.token = token;
    }

    public void setItems(List<PostItem> next) {
        items.clear();
        if (next != null)
            items.addAll(next);
        notifyDataSetChanged();
        activePos = RecyclerView.NO_POSITION;
    }

    @Override
    public VH onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_feed_post, parent, false);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(VH h, int pos) {
        PostItem p = items.get(pos);

        h.caption.setText(p.text != null ? p.text : "");

        boolean isVideo = "video".equalsIgnoreCase(p.mediaType);
        h.playerView.setVisibility(isVideo ? View.VISIBLE : View.GONE);
        h.imageView.setVisibility(isVideo ? View.GONE : View.VISIBLE);
        h.muteBadge.setVisibility(isVideo ? View.VISIBLE : View.GONE);

        if (!isVideo) {
            // ✅ Load image with Glide
            try {
                if (p.mediaUrl != null && !p.mediaUrl.trim().isEmpty()) {
                    com.bumptech.glide.Glide.with(activity)
                            .load(p.mediaUrl)
                            .centerCrop()
                            .into(h.imageView);
                } else {
                    h.imageView.setImageDrawable(null);
                }
            } catch (Exception ignored) {
            }
        }

        // mute toggle (Facebook: tap speaker toggles)
        h.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
        h.muteBadge.setOnClickListener(v -> {
            boolean nextMuted = !VideoPlaybackManager.get().isMuted();
            VideoPlaybackManager.get().setMuted(nextMuted);
            h.muteBadge.setText(nextMuted ? "🔇" : "🔊");
        });

        // IMPORTANT: if this is NOT the active item, ensure player is detached from
        // this row
        if (pos != activePos) {
            VideoPlaybackManager.get().detach(h.playerView);
        }
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    @Override
    public void onViewRecycled(VH h) {
        super.onViewRecycled(h);
        VideoPlaybackManager.get().detach(h.playerView);
        try {
            h.imageView.setImageDrawable(null);
        } catch (Exception ignored) {
        }
    }

    // Facebook-style: pick the most-visible item and play ONLY that
    public void handleScrollAutoplay(RecyclerView rv) {
        int bestPos = RecyclerView.NO_POSITION;
        float bestVisible = 0f;

        Rect parentRect = new Rect();
        rv.getGlobalVisibleRect(parentRect);

        for (int i = 0; i < rv.getChildCount(); i++) {
            View child = rv.getChildAt(i);
            Rect r = new Rect();
            boolean vis = child.getGlobalVisibleRect(r);
            if (!vis)
                continue;

            int visibleH = Math.min(r.bottom, parentRect.bottom) - Math.max(r.top, parentRect.top);
            float pct = visibleH / (float) child.getHeight();

            int pos = rv.getChildAdapterPosition(child);
            if (pos == RecyclerView.NO_POSITION)
                continue;

            if (pct > bestVisible) {
                bestVisible = pct;
                bestPos = pos;
            }
        }

        if (bestPos == RecyclerView.NO_POSITION)
            return;

        // threshold like your web: require ~60% visible
        if (bestVisible < 0.60f) {
            VideoPlaybackManager.get().pause();
            activePos = RecyclerView.NO_POSITION;
            return;
        }

        PostItem p = items.get(bestPos);
        if (p == null)
            return;

        boolean isVideo = "video".equalsIgnoreCase(p.mediaType);
        if (!isVideo || p.mediaUrl == null || p.mediaUrl.trim().isEmpty()) {
            VideoPlaybackManager.get().pause();
            activePos = RecyclerView.NO_POSITION;
            return;
        }

        if (activePos != bestPos) {
            activePos = bestPos;
            notifyDataSetChanged(); // so non-active rows detach

            // ✅ View tick: count once when a new video becomes active
            try {
                PostItem ap = items.get(activePos);
                if (ap != null && "video".equalsIgnoreCase(ap.mediaType)) {
                    if (ap.id != null && !ap.id.equals(lastViewedPostId)) {
                        lastViewedPostId = ap.id;
                        PostApi.sendViewTick(apiBase, ap.id, token);
                    }
                }
            } catch (Exception ignored) {
            }
        }

        RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(bestPos);
        if (vh instanceof VH) {
            VH row = (VH) vh;
            VideoPlaybackManager.get().setMuted(true); // Facebook feed default
            row.muteBadge.setText("🔇");
            VideoPlaybackManager.get().play(activity, p.mediaUrl, row.playerView);
        }
    }

    static class VH extends RecyclerView.ViewHolder {
        PlayerView playerView;
        ImageView imageView;
        TextView caption;
        TextView muteBadge;

        VH(View itemView) {
            super(itemView);
            playerView = itemView.findViewById(R.id.playerView);
            imageView = itemView.findViewById(R.id.imageView);
            caption = itemView.findViewById(R.id.caption);
            muteBadge = itemView.findViewById(R.id.muteBadge);
        }
    }
}
