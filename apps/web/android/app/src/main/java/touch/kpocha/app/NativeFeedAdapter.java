//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedAdapter.java
package touch.kpocha.app;

import android.app.Activity;
import android.graphics.Rect;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;
import android.content.Intent;
import android.net.Uri;

import androidx.recyclerview.widget.RecyclerView;

import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.List;

public class NativeFeedAdapter extends RecyclerView.Adapter<NativeFeedAdapter.VH> {

    public interface Listener {
        void onRequestReelsAt(int position);

        void onOpenPost(PostItem item);
    }

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
    private Listener listener;

    public NativeFeedAdapter(Activity activity, String apiBase, String token) {
        this.activity = activity;
        this.apiBase = apiBase;
        this.token = token;
    }

    public void setListener(Listener l) {
        this.listener = l;
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
        final String bindId = p != null ? p.id : null;

        if (p == null)
            return;

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
        // ✅ Facebook rule: FEED shows a mute badge, REELS shows NONE
        if (h.muteBadge != null) {
            boolean showMuteInFeedOnly = isVideo && (mode == Mode.FEED);
            h.muteBadge.setVisibility(showMuteInFeedOnly ? View.VISIBLE : View.GONE);
        }

        if (h.muteBadge != null && isVideo && mode == Mode.FEED) {
            h.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
        }

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

        // ✅ counts/actions (wired to backend + web routes)
        if (h.countsRow != null) {
            h.countsRow
                    .setText(p.likesCount + " likes • " + p.commentsCount + " comments • " + p.sharesCount + " shares");
        }

        // Load stats (best-effort) — updates UI when it arrives
        if (bindId != null && bindId.length() > 0 && !p.statsLoaded) {
            PostApi.fetchStats(apiBase, bindId, token, new PostApi.StatsCallback() {
                @Override
                public void onSuccess(PostItem st) {

                    if (st == null)
                        return;

                    // ✅ Guard: ignore late callback if this ViewHolder is now bound to a different
                    // post
                    if (p == null || p.id == null || bindId == null || !p.id.equals(bindId))
                        return;

                    // ✅ Only mark loaded AFTER we know we got real stats for the right row
                    p.statsLoaded = true;

                    try {
                        p.viewsCount = st.viewsCount;
                        p.likesCount = st.likesCount;
                        p.commentsCount = st.commentsCount;
                        p.sharesCount = st.sharesCount;
                        p.likedByMe = st.likedByMe;
                    } catch (Exception ignored) {
                    }

                    activity.runOnUiThread(() -> {
                        // Holder might have been recycled; verify it still points to same post
                        int curPos = h.getBindingAdapterPosition();
                        if (curPos == RecyclerView.NO_POSITION)
                            return;
                        if (curPos >= items.size())
                            return;

                        PostItem cur = items.get(curPos);
                        if (cur == null || cur.id == null || bindId == null || !cur.id.equals(bindId))
                            return;

                        if (h.countsRow != null) {
                            h.countsRow.setText(cur.likesCount + " likes • " + cur.commentsCount + " comments • "
                                    + cur.sharesCount + " shares");
                        }
                        if (h.btnLike != null) {
                            h.btnLike.setText(cur.likedByMe ? "Liked" : "Like");
                        }
                    });
                }

                @Override
                public void onError(String message) {
                }
            });
        }

        if (h.btnLike != null) {
            h.btnLike.setText(p.likedByMe ? "Liked" : "Like");
            h.btnLike.setOnClickListener(v -> {
                if (p.id == null || p.id.length() == 0)
                    return;

                final boolean nextLike = !p.likedByMe;

                // optimistic UI
                p.likedByMe = nextLike;
                p.likesCount = Math.max(0, p.likesCount + (nextLike ? 1 : -1));
                h.btnLike.setText(p.likedByMe ? "Liked" : "Like");
                if (h.countsRow != null) {
                    h.countsRow.setText(
                            p.likesCount + " likes • " + p.commentsCount + " comments • " + p.sharesCount + " shares");
                }

                PostApi.toggleLike(apiBase, p.id, token, nextLike, new PostApi.ToggleLikeCallback() {
                    @Override
                    public void onSuccess(boolean likedNow, int likesCountFromServer) {
                        try {
                            if (bindId == null || !bindId.equals(p.id))
                                return;

                            p.likedByMe = likedNow;
                            if (likesCountFromServer >= 0)
                                p.likesCount = likesCountFromServer;
                        } catch (Exception ignored) {
                        }

                        activity.runOnUiThread(() -> {
                            if (h.btnLike != null)
                                h.btnLike.setText(p.likedByMe ? "Liked" : "Like");
                            if (h.countsRow != null) {
                                h.countsRow.setText(p.likesCount + " likes • " + p.commentsCount + " comments • "
                                        + p.sharesCount + " shares");
                            }
                        });
                    }

                    @Override
                    public void onError(String message) {
                        if (p == null || p.id == null || bindId == null || !p.id.equals(bindId))
                            return;

                        // revert on error
                        try {
                            p.likedByMe = !nextLike;
                            p.likesCount = Math.max(0, p.likesCount + (!nextLike ? 1 : -1));
                        } catch (Exception ignored) {
                        }

                        activity.runOnUiThread(() -> {
                            if (h.btnLike != null)
                                h.btnLike.setText(p.likedByMe ? "Liked" : "Like");
                            if (h.countsRow != null) {
                                h.countsRow.setText(p.likesCount + " likes • " + p.commentsCount + " comments • "
                                        + p.sharesCount + " shares");
                            }
                        });
                    }
                });
            });
        }

        if (h.btnComment != null) {
            h.btnComment.setOnClickListener(v -> {
                if (p.id == null || p.id.length() == 0)
                    return;
                NativeNav.open(activity, "/post/" + Uri.encode(p.id));
            });
        }

        if (h.btnShare != null) {
            h.btnShare.setOnClickListener(v -> {
                if (p.id == null || p.id.length() == 0)
                    return;

                // notify backend
                PostApi.sendShareTick(apiBase, p.id, token);

                // Android share sheet
                try {
                    String shareUrl = apiBase;
                    if (shareUrl.endsWith("/"))
                        shareUrl = shareUrl.substring(0, shareUrl.length() - 1);
                    shareUrl = shareUrl + "/browse?post=" + Uri.encode(p.id);

                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, shareUrl);
                    activity.startActivity(Intent.createChooser(send, "Share post"));
                } catch (Exception ignored) {
                }
            });
        }

        // Not active? detach player from this row
        if (h.playerView != null && pos != activePos) {
            VideoPlaybackManager.get().detach(h.playerView);
        }

        // ✅ FEED: mute badge toggles sound (badge must not trigger itemView click)
        if (h.muteBadge != null) {
            h.muteBadge.setClickable(true);
            h.muteBadge.setOnClickListener(v -> {
                if (!"video".equalsIgnoreCase(p.mediaType))
                    return;
                VideoPlaybackManager.get().toggleMuted();
                h.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
            });
        }

        // ✅ REELS: tap video should work (PlayerView often eats touches)
        // - No speaker icon in reels, but tap toggles mute/unmute (Facebook-style)
        // - Also toggle play/pause on tap (Facebook reels behavior)
        if (h.playerView != null) {
            h.playerView.setClickable(true);
            h.playerView.setOnClickListener(v -> {
                if (!"video".equalsIgnoreCase(p.mediaType))
                    return;

                if (mode == Mode.REELS) {
                    // Tap toggles sound; no icon
                    VideoPlaybackManager.get().toggleMuted();

                    // Optional: tap pauses/plays like FB reels
                    VideoPlaybackManager.get().togglePlayPause();
                }
            });
        }

        h.itemView.setOnClickListener(v -> {
            boolean isVideo2 = "video".equalsIgnoreCase(p.mediaType);

            // FEED mode behavior:
            if (mode == Mode.FEED) {
                // Video -> jump into REELS at this position
                if (isVideo2 && listener != null) {
                    listener.onRequestReelsAt(pos);
                    return;
                }

                // Image/text -> open post detail (web)
                if (listener != null) {
                    listener.onOpenPost(p);
                }
                return;
            }

            // REELS mode behavior (Facebook-like):
            // Tap video toggles sound + play/pause (no on-screen speaker icon)
            if (mode == Mode.REELS && isVideo2) {
                VideoPlaybackManager.get().toggleMuted();
                VideoPlaybackManager.get().togglePlayPause();
            }
        });

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
                if (row.muteBadge != null && mode == Mode.FEED) {
                    row.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
                }
                VideoPlaybackManager.get().play(activity, p.mediaUrl, row.playerView);
            }
        }
    }

    private String timeAgo(String iso) {
        try {
            if (iso == null || iso.trim().isEmpty())
                return "";
            java.time.Instant t = java.time.Instant.parse(iso);
            long diffMs = java.time.Duration.between(t, java.time.Instant.now()).toMillis();
            long mins = diffMs / 60000;
            if (mins < 1)
                return "just now";
            if (mins < 60)
                return mins + "m";
            long hrs = mins / 60;
            if (hrs < 24)
                return hrs + "h";
            long days = hrs / 24;
            return days + "d";
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
