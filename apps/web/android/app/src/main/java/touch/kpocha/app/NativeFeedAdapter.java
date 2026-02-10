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

    public enum Mode {
        FEED, REELS
    }

    private final List<PostItem> items = new ArrayList<>();
    private final Activity activity;
    private final String apiBase;
    private final String token;

    private String lastViewedPostId = null;
    private int activePos = RecyclerView.NO_POSITION;

    private Mode mode = Mode.FEED;

    public NativeFeedAdapter(Activity activity, String apiBase, String token) {
        this.activity = activity;
        this.apiBase = apiBase;
        this.token = token;
    }

    public void setMode(Mode m) {
        if (m == null)
            return;
        if (mode == m)
            return;
        mode = m;
        activePos = RecyclerView.NO_POSITION;
        notifyDataSetChanged();
    }

    public Mode getMode() {
        return mode;
    }

    public void setItems(List<PostItem> next) {
        items.clear();
        if (next != null)
            items.addAll(next);
        notifyDataSetChanged();
        activePos = RecyclerView.NO_POSITION;
    }

    @Override
    public int getItemViewType(int position) {
        return mode == Mode.REELS ? 1 : 0;
    }

    @Override
    public VH onCreateViewHolder(ViewGroup parent, int viewType) {
        int layout = (viewType == 1) ? R.layout.item_reel_post : R.layout.item_feed_post;
        View v = LayoutInflater.from(parent.getContext()).inflate(layout, parent, false);
        return new VH(v, viewType);
    }

    @Override
    public void onBindViewHolder(VH h, int pos) {
        PostItem p = items.get(pos);

        // basic text
        if (h.caption != null)
            h.caption.setText(p.text != null ? p.text : "");

        // header (if present)
        if (h.authorName != null)
            h.authorName.setText((p.authorName != null && p.authorName.length() > 0) ? p.authorName : "User");
        if (h.postTime != null)
            h.postTime.setText(timeAgo(p.createdAt));

        // avatar
        if (h.authorAvatar != null) {
            try {
                if (p.authorAvatar != null && p.authorAvatar.trim().length() > 0) {
                    com.bumptech.glide.Glide.with(activity).load(p.authorAvatar).centerCrop().into(h.authorAvatar);
                } else {
                    h.authorAvatar.setImageResource(android.R.drawable.sym_def_app_icon);
                }
            } catch (Exception ignored) {
            }
        }

        boolean isVideo = "video".equalsIgnoreCase(p.mediaType);

        if (h.playerView != null)
            h.playerView.setVisibility(isVideo ? View.VISIBLE : View.GONE);
        if (h.imageView != null)
            h.imageView.setVisibility(isVideo ? View.GONE : View.VISIBLE);
        if (h.muteBadge != null)
            h.muteBadge.setVisibility(isVideo ? View.VISIBLE : View.GONE);

        if (!isVideo && h.imageView != null) {
            try {
                if (p.mediaUrl != null && !p.mediaUrl.trim().isEmpty()) {
                    com.bumptech.glide.Glide.with(activity).load(p.mediaUrl).centerCrop().into(h.imageView);
                } else {
                    h.imageView.setImageDrawable(null);
                }
            } catch (Exception ignored) {
            }
        }

        // counts/actions are FEED-only for now (views exist via sendViewTick)
        if (h.countsRow != null) {
            h.countsRow.setText("0 likes • 0 comments • 0 shares");
        }
        if (h.btnLike != null) {
            h.btnLike.setOnClickListener(v -> android.widget.Toast
                    .makeText(activity, "Like (wire API later)", android.widget.Toast.LENGTH_SHORT).show());
        }
        if (h.btnComment != null) {
            h.btnComment.setOnClickListener(v -> android.widget.Toast
                    .makeText(activity, "Comment (wire UI later)", android.widget.Toast.LENGTH_SHORT).show());
        }
        if (h.btnShare != null) {
            h.btnShare.setOnClickListener(v -> android.widget.Toast
                    .makeText(activity, "Share (wire later)", android.widget.Toast.LENGTH_SHORT).show());
        }

        // mute toggle (persistent preference is in VideoPlaybackManager)
        if (h.muteBadge != null) {
            h.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
            h.muteBadge.setOnClickListener(v -> {
                boolean nextMuted = !VideoPlaybackManager.get().isMuted();
                VideoPlaybackManager.get().setMuted(nextMuted);
                h.muteBadge.setText(nextMuted ? "🔇" : "🔊");
            });
        }

        // Not active? detach player from this row
        if (h.playerView != null && pos != activePos) {
            VideoPlaybackManager.get().detach(h.playerView);
        }

        // Taps: in FEED, tap opens “reels mode at this post” (we’ll implement in
        // Activity later)
        // For now: tap does nothing native-side; you can add intents later.
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    @Override
    public void onViewRecycled(VH h) {
        super.onViewRecycled(h);
        if (h.playerView != null)
            VideoPlaybackManager.get().detach(h.playerView);
        try {
            if (h.imageView != null)
                h.imageView.setImageDrawable(null);
        } catch (Exception ignored) {
        }
    }

    // Autoplay: pick most-visible item and play ONLY that (works for FEED + REELS)
    public void handleScrollAutoplay(RecyclerView rv) {
        if (items.isEmpty())
            return;

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

        // threshold: require ~60% visible
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
            final int prev = activePos;
            activePos = bestPos;

            // Avoid notifyDataSetChanged inside scroll/layout
            final int nextPos = activePos;
            rv.post(() -> {
                if (prev != RecyclerView.NO_POSITION)
                    notifyItemChanged(prev);
                if (nextPos != RecyclerView.NO_POSITION)
                    notifyItemChanged(nextPos);
            });

            // view tick: count once when new video becomes active
            try {
                PostItem ap = items.get(activePos);
                if (ap != null && ap.id != null && !ap.id.equals(lastViewedPostId)) {
                    lastViewedPostId = ap.id;
                    PostApi.sendViewTick(apiBase, ap.id, token);
                }
            } catch (Exception ignored) {
            }
        }

        RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(bestPos);
        if (vh instanceof VH) {
            VH row = (VH) vh;
            if (row.playerView != null) {
                if (row.muteBadge != null)
                    row.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
                VideoPlaybackManager.get().play(activity, p.mediaUrl, row.playerView);
            }
        }
    }

    private String timeAgo(String iso) {
        try {
            if (iso == null || iso.trim().length() == 0)
                return "";
            // Very simple fallback (you can improve later)
            return "";
        } catch (Exception ignored) {
            return "";
        }
    }

    static class VH extends RecyclerView.ViewHolder {
        PlayerView playerView;
        ImageView imageView;

        ImageView authorAvatar;
        TextView authorName;
        TextView postTime;

        TextView caption;
        TextView muteBadge;

        TextView countsRow;
        TextView btnLike;
        TextView btnComment;
        TextView btnShare;

        VH(View itemView, int viewType) {
            super(itemView);

            playerView = itemView.findViewById(R.id.playerView);
            imageView = itemView.findViewById(R.id.imageView);

            authorAvatar = itemView.findViewById(R.id.authorAvatar);
            authorName = itemView.findViewById(R.id.authorName);
            postTime = itemView.findViewById(R.id.postTime);

            caption = itemView.findViewById(R.id.caption);
            muteBadge = itemView.findViewById(R.id.muteBadge);

            countsRow = itemView.findViewById(R.id.countsRow);
            btnLike = itemView.findViewById(R.id.btnLike);
            btnComment = itemView.findViewById(R.id.btnComment);
            btnShare = itemView.findViewById(R.id.btnShare);
        }
    }
}
