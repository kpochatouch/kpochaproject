//apps/web/android/app/src/main/java/touch/kpocha/app/CommentsAdapter.java
package touch.kpocha.app;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

public class CommentsAdapter extends RecyclerView.Adapter<CommentsAdapter.VH> {

    private final List<CommentItem> items = new ArrayList<>();

    public void setItems(List<CommentItem> next) {
        items.clear();
        if (next != null)
            items.addAll(next);
        notifyDataSetChanged();
    }

    public void prepend(CommentItem it) {
        if (it == null)
            return;
        items.add(0, it);
        notifyItemInserted(0);
    }

    @Override
    public VH onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_comment, parent, false);
        return new VH(v);
    }

    @Override
    public void onBindViewHolder(VH h, int pos) {
        CommentItem c = items.get(pos);
        if (c == null)
            return;

        if (h.authorName != null)
            h.authorName.setText((c.authorName == null || c.authorName.trim().isEmpty()) ? "User" : c.authorName);
        if (h.text != null)
            h.text.setText(c.text == null ? "" : c.text);

        if (h.avatar != null) {
            try {
                if (c.authorAvatar != null && !c.authorAvatar.trim().isEmpty()) {
                    com.bumptech.glide.Glide.with(h.avatar.getContext()).load(c.authorAvatar).centerCrop()
                            .into(h.avatar);
                } else {
                    h.avatar.setImageResource(android.R.drawable.sym_def_app_icon);
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class VH extends RecyclerView.ViewHolder {
        ImageView avatar;
        TextView authorName;
        TextView text;

        VH(View itemView) {
            super(itemView);
            avatar = itemView.findViewById(R.id.commentAvatar);
            authorName = itemView.findViewById(R.id.commentAuthor);
            text = itemView.findViewById(R.id.commentText);
        }
    }
}
