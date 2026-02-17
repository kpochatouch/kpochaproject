//apps/web/android/app/src/main/java/touch/kpocha/app/PostItem.java
package touch.kpocha.app;

public class PostItem {
    public String id;

    public String authorName;
    public String authorAvatar;

    public String text;

    public String mediaUrl;
    public String mediaType; // "video" or "image"
    public String thumbnailUrl; // ✅ for videos (poster) or images (optional)
    public String createdAt;

    // ✅ preference support (NOT a filter)
    public String lga;

    // ✅ counts (wired to /stats)
    public int viewsCount = 0;
    public int likesCount = 0;
    public int commentsCount = 0;
    public int sharesCount = 0;

    // ✅ user state (wired to /stats + /like)
    public boolean likedByMe = false;
    public boolean statsLoaded = false;

    public int mediaWidth = 0;
    public int mediaHeight = 0;

    public int savesCount = 0;
    public boolean savedByMe = false;

    // prevents "optimistic + stats overwrite" flicker
    public long lastLocalEngagementMs = 0;
    public long lastStatsRequestMs = 0;
}
