//apps/web/android/app/src/main/java/touch/kpocha/app/NativeFeedAdapter.java
package touch.kpocha.app;

import android.app.Activity;
import android.graphics.Rect;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.ProgressBar;
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

    private EngagementBinder.Row pickEngRow(VH h) {
        return (mode == Mode.REELS) ? h.railEng : h.feedEng;
    }

    @Override
    public void onBindViewHolder(VH h, int pos) {
        PostItem p = items.get(pos);
        final String bindId = p != null ? p.id : null;
        final String rowId = bindId;

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

        // ✅ For videos, imageView becomes the poster (thumbnail) until first frame
        if (h.imageView != null) {
            if (isVideo) {
                boolean hasThumb = (p.thumbnailUrl != null && p.thumbnailUrl.trim().length() > 0);
                h.imageView.setVisibility(hasThumb ? View.VISIBLE : View.GONE);
            } else {
                h.imageView.setVisibility(View.VISIBLE);
            }
        }

        // ✅ Facebook rule: FEED shows a mute badge, REELS shows NONE
        if (h.muteBadge != null) {
            boolean showMuteInFeedOnly = isVideo && (mode == Mode.FEED);
            h.muteBadge.setVisibility(showMuteInFeedOnly ? View.VISIBLE : View.GONE);
        }

        if (h.muteBadge != null && isVideo && mode == Mode.FEED) {
            h.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
        }

        // ✅ Facebook-style resize mode decision (applies to reels + feed)
        applyAutoResizeMode(h.playerView, p);

        if (h.imageView != null) {
            try {
                if (isVideo) {
                    // ✅ Video poster
                    if (p.thumbnailUrl != null && !p.thumbnailUrl.trim().isEmpty()) {
                        com.bumptech.glide.Glide.with(activity).load(p.thumbnailUrl).centerCrop().into(h.imageView);
                    } else {
                        h.imageView.setImageDrawable(null);
                    }
                } else {
                    // ✅ Normal image post
                    if (p.mediaUrl != null && !p.mediaUrl.trim().isEmpty()) {
                        com.bumptech.glide.Glide.with(activity).load(p.mediaUrl).centerCrop().into(h.imageView);
                    } else {
                        h.imageView.setImageDrawable(null);
                    }
                }
            } catch (Exception ignored) {
            }
        }

        // ✅ counts row text
        if (h.countsRow != null) {
            h.countsRow.setText(
                    p.likesCount + " likes • " + p.commentsCount + " comments • " + p.sharesCount + " shares");
        }

        // ✅ engagement (render + click handlers)
        EngagementBinder.Row r = pickEngRow(h);
        EngagementBinder.render(r, p);

        if (r != null) {

            // LIKE
            if (r.like != null) {
                r.like.setOnClickListener(v -> {
                    if (p.id == null || p.id.length() == 0)
                        return;

                    final boolean nextLike = !p.likedByMe;
                    p.lastLocalEngagementMs = System.currentTimeMillis();

                    // optimistic
                    p.likedByMe = nextLike;
                    p.likesCount = Math.max(0, p.likesCount + (nextLike ? 1 : -1));
                    EngagementBinder.render(r, p);

                    if (h.countsRow != null) {
                        h.countsRow.setText(
                                p.likesCount + " likes • " + p.commentsCount + " comments • " + p.sharesCount
                                        + " shares");
                    }

                    PostApi.toggleLike(apiBase, p.id, token, nextLike, new PostApi.ToggleLikeCallback() {
                        @Override
                        public void onSuccess(boolean likedNow, int likesCountFromServer) {
                            if (rowId == null || !rowId.equals(p.id))
                                return;
                            p.likedByMe = likedNow;
                            if (likesCountFromServer >= 0)
                                p.likesCount = likesCountFromServer;

                            activity.runOnUiThread(() -> {
                                EngagementBinder.render(r, p);
                                if (h.countsRow != null) {
                                    h.countsRow.setText(
                                            p.likesCount + " likes • " + p.commentsCount + " comments • "
                                                    + p.sharesCount + " shares");
                                }
                            });
                        }

                        @Override
                        public void onError(String message) {
                            if (rowId == null || !rowId.equals(p.id))
                                return;

                            p.likedByMe = !nextLike;
                            p.likesCount = Math.max(0, p.likesCount + (!nextLike ? 1 : -1));

                            activity.runOnUiThread(() -> {
                                EngagementBinder.render(r, p);
                                if (h.countsRow != null) {
                                    h.countsRow.setText(
                                            p.likesCount + " likes • " + p.commentsCount + " comments • "
                                                    + p.sharesCount + " shares");
                                }
                            });
                        }

                    });
                });
            }

            // SAVE
            if (r.save != null) {
                r.save.setOnClickListener(v -> {
                    if (p.id == null || p.id.length() == 0)
                        return;

                    final boolean nextSave = !p.savedByMe;
                    p.lastLocalEngagementMs = System.currentTimeMillis();

                    // optimistic
                    p.savedByMe = nextSave;
                    p.savesCount = Math.max(0, p.savesCount + (nextSave ? 1 : -1));
                    EngagementBinder.render(r, p);

                    PostApi.toggleSave(apiBase, p.id, token, nextSave, new PostApi.ToggleSaveCallback() {

                        @Override
                        public void onSuccess(boolean savedNow, int savesCountFromServer) {
                            if (rowId == null || !rowId.equals(p.id))
                                return;

                            p.savedByMe = savedNow;
                            if (savesCountFromServer >= 0)
                                p.savesCount = savesCountFromServer;

                            activity.runOnUiThread(() -> EngagementBinder.render(r, p));
                        }

                        @Override
                        public void onError(String message) {
                            if (rowId == null || !rowId.equals(p.id))
                                return;

                            p.savedByMe = !nextSave;
                            p.savesCount = Math.max(0, p.savesCount + (!nextSave ? 1 : -1));

                            activity.runOnUiThread(() -> EngagementBinder.render(r, p));
                        }

                    });
                });
            }

            // COMMENT (native)
            if (r.comment != null) {
                r.comment.setOnClickListener(v -> {
                    if (p.id == null || p.id.trim().isEmpty())
                        return;

                    Intent i = new Intent(activity, NativeCommentsActivity.class);
                    i.putExtra(NativeCommentsActivity.EXTRA_API_BASE, apiBase);
                    i.putExtra(NativeCommentsActivity.EXTRA_TOKEN, token);
                    i.putExtra(NativeCommentsActivity.EXTRA_POST_ID, p.id);
                    activity.startActivity(i);
                });
            }

            // SHARE
            if (r.share != null) {
                r.share.setOnClickListener(v -> {
                    if (p.id == null || p.id.length() == 0)
                        return;

                    PostApi.sendShareTick(apiBase, p.id, token);

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
        }

        // Load stats (best-effort) — updates UI when it arrives
        if (bindId != null && bindId.length() > 0 && !p.statsLoaded) {

            // mark when THIS stats request started
            final long requestMs = System.currentTimeMillis();
            p.lastStatsRequestMs = requestMs;

            PostApi.fetchStats(apiBase, bindId, token, new PostApi.StatsCallback() {
                @Override
                public void onSuccess(PostItem st) {
                    if (st == null)
                        return;

                    // ✅ Guard: ignore late callback if this row is now a different post
                    if (rowId == null || p == null || p.id == null || !rowId.equals(p.id))
                        return;

                    // ✅ If user tapped like/save AFTER this request started, ignore stale stats
                    if (p.lastLocalEngagementMs > 0 && p.lastLocalEngagementMs > requestMs) {
                        // do not overwrite optimistic UI
                        p.statsLoaded = true; // still mark loaded so we don't spam requests
                        return;
                    }

                    p.statsLoaded = true;

                    try {
                        p.viewsCount = st.viewsCount;
                        p.likesCount = st.likesCount;
                        p.commentsCount = st.commentsCount;
                        p.sharesCount = st.sharesCount;
                        p.savesCount = st.savesCount;
                        p.likedByMe = st.likedByMe;
                        p.savedByMe = st.savedByMe;
                    } catch (Exception ignored) {
                    }

                    activity.runOnUiThread(() -> {
                        int curPos = h.getBindingAdapterPosition();
                        if (curPos == RecyclerView.NO_POSITION)
                            return;
                        if (curPos >= items.size())
                            return;

                        PostItem cur = items.get(curPos);
                        if (cur == null || cur.id == null || bindId == null || !cur.id.equals(bindId))
                            return;

                        if (h.countsRow != null) {
                            h.countsRow.setText(
                                    cur.likesCount + " likes • " +
                                            cur.commentsCount + " comments • " +
                                            cur.sharesCount + " shares • " +
                                            cur.savesCount + " saves");
                        }

                        EngagementBinder.Row rr = pickEngRow(h);
                        EngagementBinder.render(rr, cur);
                    });
                }

                @Override
                public void onError(String message) {
                }
            });
        }

        // Not active? detach player from this row
        if (h.playerView != null && pos != activePos) {
            VideoPlaybackManager.get().detach(h.playerView);

            // ✅ if it's a video, restore poster visibility when not active
            if ("video".equalsIgnoreCase(p.mediaType) && h.imageView != null) {

                boolean hasThumb = (p.thumbnailUrl != null
                        && p.thumbnailUrl.trim().length() > 0);
                h.imageView.setVisibility(hasThumb ? View.VISIBLE : View.GONE);
            }
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

        if (h.tapOverlay != null) {
            h.tapOverlay.setClickable(true);
            h.tapOverlay.setOnClickListener(v -> {
                int clickPos = h
                        .getBindingAdapterPosition();
                if (clickPos == RecyclerView.NO_POSITION)
                    return;
                if (clickPos < 0 || clickPos >= items.size())
                    return;

                PostItem cp = items.get(clickPos);
                if (cp == null)
                    return;

                boolean isVid = "video".equalsIgnoreCase(cp.mediaType);

                if (mode == Mode.FEED) {
                    if (isVid && listener != null) {
                        listener.onRequestReelsAt(clickPos);
                        return;
                    }
                    if (!isVid && listener != null) {
                        listener.onOpenPost(cp);
                        return;
                    }
                    return;
                }

                // REELS behavior (Facebook-style):
                // tap toggles play/pause, and sound follows play state
                if (mode == Mode.REELS && isVid) {
                    boolean playing = VideoPlaybackManager.get().isPlaying();
                    VideoPlaybackManager.get().setPlayingReelsStyle(!playing);
                }

            });
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
                if (row.muteBadge != null && mode == Mode.FEED) {
                    row.muteBadge.setText(VideoPlaybackManager.get().isMuted() ? "🔇" : "🔊");
                }
                // show spinner while waiting
                if (row.loadingSpinner != null) {
                    row.loadingSpinner.setVisibility(View.VISIBLE);
                }

                // show poster if available (video thumbnail)
                if (row.imageView != null) {
                    boolean hasThumb = (p.thumbnailUrl != null && p.thumbnailUrl.trim().length() > 0);
                    row.imageView.setVisibility(hasThumb ? View.VISIBLE : View.GONE);
                }

                // hide spinner on first frame for this URL
                final String urlNow = p.mediaUrl;
                VideoPlaybackManager.get().onFirstFrameForUrl(urlNow, (u) -> {

                    if (u == null || urlNow == null)
                        return;
                    if (!u.equals(urlNow))
                        return;

                    activity.runOnUiThread(() -> {
                        // holder might be recycled; just best-effort hide
                        if (row.loadingSpinner != null)
                            row.loadingSpinner.setVisibility(View.GONE);
                        if (row.imageView != null)
                            row.imageView.setVisibility(View.GONE);

                    });
                });

                VideoPlaybackManager.get().play(activity, p.mediaUrl, row.playerView);
                // Safety: never spin forever if video is already READY/playing
                row.itemView.postDelayed(() -> {
                    try {
                        if (row.loadingSpinner != null)
                            row.loadingSpinner.setVisibility(View.GONE);
                        // keep poster if you want; or hide it if you prefer:
                        // if (row.imageView != null) row.imageView.setVisibility(View.GONE);
                    } catch (Exception ignored) {
                    }
                }, 1200);

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

    private void applyAutoResizeMode(PlayerView pv, PostItem p) {
        if (pv == null || p == null)
            return;

        // Default: fit (safe)
        int modeToUse = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT;

        int w = p.mediaWidth;
        int h = p.mediaHeight;

        // If we have dimensions, decide like Facebook:
        // - If it's "vertical-ish" (close to 9:16), use ZOOM to fill screen.
        // - Otherwise use FIT (letterbox).
        if (w > 0 && h > 0) {
            float r = (float) w / (float) h; // width/height
            float nineSixteen = 9f / 16f; // 0.5625

            // tolerance band
            if (r <= (nineSixteen + 0.10f)) {
                modeToUse = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
            } else {
                modeToUse = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT;
            }
        }

        try {
            pv.setResizeMode(modeToUse);
        } catch (Exception ignored) {
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
        View tapOverlay;
        ProgressBar loadingSpinner;

        TextView countsRow;

        EngagementBinder.Row feedEng = null;
        EngagementBinder.Row railEng = null;

        VH(View itemView, int viewType) {
            super(itemView);

            playerView = itemView.findViewById(R.id.playerView);
            imageView = itemView.findViewById(R.id.imageView);

            authorAvatar = itemView.findViewById(R.id.authorAvatar);
            authorName = itemView.findViewById(R.id.authorName);
            postTime = itemView.findViewById(R.id.postTime);

            caption = itemView.findViewById(R.id.caption);
            muteBadge = itemView.findViewById(R.id.muteBadge);
            tapOverlay = itemView.findViewById(R.id.tapOverlay);
            loadingSpinner = itemView.findViewById(R.id.loadingSpinner);

            countsRow = itemView.findViewById(R.id.countsRow);

            // FEED engagement row (view_engagement_row.xml)
            View engLike = itemView.findViewById(R.id.engLike);
            if (engLike != null) {
                feedEng = new EngagementBinder.Row();
                feedEng.like = engLike;
                feedEng.likeIcon = itemView.findViewById(R.id.engLikeIcon);
                feedEng.likeCount = itemView.findViewById(R.id.engLikeCount);

                feedEng.comment = itemView.findViewById(R.id.engComment);
                feedEng.commentIcon = itemView.findViewById(R.id.engCommentIcon);
                feedEng.commentCount = itemView.findViewById(R.id.engCommentCount);

                feedEng.share = itemView.findViewById(R.id.engShare);
                feedEng.shareIcon = itemView.findViewById(R.id.engShareIcon);
                feedEng.shareCount = itemView.findViewById(R.id.engShareCount);

                feedEng.save = itemView.findViewById(R.id.engSave);
                feedEng.saveIcon = itemView.findViewById(R.id.engSaveIcon);
                feedEng.saveCount = itemView.findViewById(R.id.engSaveCount);
            }

            // REELS engagement rail (view_engagement_rail.xml)
            View railLike = itemView.findViewById(R.id.railLike);
            if (railLike != null) {
                railEng = new EngagementBinder.Row();
                railEng.like = railLike;
                railEng.likeIcon = itemView.findViewById(R.id.railLikeIcon);
                railEng.likeCount = itemView.findViewById(R.id.railLikeCount);

                railEng.comment = itemView.findViewById(R.id.railComment);
                railEng.commentIcon = itemView.findViewById(R.id.railCommentIcon);
                railEng.commentCount = itemView.findViewById(R.id.railCommentCount);

                railEng.share = itemView.findViewById(R.id.railShare);
                railEng.shareIcon = itemView.findViewById(R.id.railShareIcon);
                railEng.shareCount = itemView.findViewById(R.id.railShareCount);

                railEng.save = itemView.findViewById(R.id.railSave);
                railEng.saveIcon = itemView.findViewById(R.id.railSaveIcon);
                railEng.saveCount = itemView.findViewById(R.id.railSaveCount);
            }

        }
    }
}
