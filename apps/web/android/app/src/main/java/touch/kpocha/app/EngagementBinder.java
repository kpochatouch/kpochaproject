//apps/web/android/app/src/main/java/touch/kpocha/app/EngagementBinder.java
package touch.kpocha.app;

import android.content.res.ColorStateList;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

public class EngagementBinder {

    public static class Row {
        public View like;
        public ImageView likeIcon;
        public TextView likeCount;

        public View comment;
        public ImageView commentIcon;
        public TextView commentCount;

        public View share;
        public ImageView shareIcon;
        public TextView shareCount;

        public View save;
        public ImageView saveIcon;
        public TextView saveCount;
    }

    // Bind counts + icon states for FEED row or REELS rail
    public static void render(Row r, PostItem p) {
        if (r == null || p == null)
            return;

        // counts
        if (r.likeCount != null)
            r.likeCount.setText(String.valueOf(Math.max(0, p.likesCount)));
        if (r.commentCount != null)
            r.commentCount.setText(String.valueOf(Math.max(0, p.commentsCount)));
        if (r.shareCount != null)
            r.shareCount.setText(String.valueOf(Math.max(0, p.sharesCount)));
        if (r.saveCount != null)
            r.saveCount.setText(String.valueOf(Math.max(0, p.savesCount)));

        // icon states + tint (IMPORTANT: XML tint forces same color otherwise)
        if (r.likeIcon != null) {
            r.likeIcon.setImageResource(p.likedByMe ? R.drawable.ic_like_filled : R.drawable.ic_like);

            int tint = p.likedByMe
                    ? ContextCompat.getColor(r.likeIcon.getContext(), R.color.kpocha_like_active)
                    : ContextCompat.getColor(r.likeIcon.getContext(), R.color.kpocha_icon);

            r.likeIcon.setImageTintList(ColorStateList.valueOf(tint));
        }

        if (r.saveIcon != null) {
            r.saveIcon.setImageResource(p.savedByMe ? R.drawable.ic_save_filled : R.drawable.ic_save);

            int tint = p.savedByMe
                    ? ContextCompat.getColor(r.saveIcon.getContext(), R.color.kpocha_save_active)
                    : ContextCompat.getColor(r.saveIcon.getContext(), R.color.kpocha_icon);

            r.saveIcon.setImageTintList(ColorStateList.valueOf(tint));
        }

    }
}
