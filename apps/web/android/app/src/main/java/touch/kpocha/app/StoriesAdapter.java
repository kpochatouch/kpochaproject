//apps/web/android/app/src/main/java/touch/kpocha/app/StoriesAdapter.java
package touch.kpocha.app;

import android.app.Activity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

public class StoriesAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {

    public interface Listener {
        void onCreateStory();

        void onStoryClicked(StoryItem item);
    }

    private static final int VT_CREATE = 0;
    private static final int VT_STORY = 1;

    private final Activity activity;
    private final List<StoryItem> items = new ArrayList<>();
    private Listener listener;

    public StoriesAdapter(Activity activity) {
        this.activity = activity;
    }

    public void setListener(Listener l) {
        this.listener = l;
    }

    public void setItems(List<StoryItem> next) {
        items.clear();
        if (next != null)
            items.addAll(next);
        notifyDataSetChanged();
    }

    @Override
    public int getItemCount() {
        // +1 for Create Story
        return 1 + items.size();
    }

    @Override
    public int getItemViewType(int position) {
        return position == 0 ? VT_CREATE : VT_STORY;
    }

    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        int layout = (viewType == VT_CREATE) ? R.layout.item_story_create : R.layout.item_story;
        View v = LayoutInflater.from(parent.getContext()).inflate(layout, parent, false);

        if (viewType == VT_CREATE)
            return new CreateVH(v);
        return new StoryVH(v);
    }

    @Override
    public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
        if (getItemViewType(position) == VT_CREATE) {
            holder.itemView.setOnClickListener(v -> {
                if (listener != null)
                    listener.onCreateStory();
            });
            return;
        }

        StoryItem it = items.get(position - 1);
        StoryVH h = (StoryVH) holder;

        h.storyName.setText(it.name != null ? it.name : "User");

        try {
            if (it.thumbUrl != null && it.thumbUrl.trim().length() > 0) {
                com.bumptech.glide.Glide.with(activity).load(it.thumbUrl).centerCrop().into(h.storyThumb);
            } else {
                h.storyThumb.setImageResource(android.R.drawable.sym_def_app_icon);
            }
        } catch (Exception ignored) {
        }

        h.itemView.setOnClickListener(v -> {
            if (listener != null)
                listener.onStoryClicked(it);
        });
    }

    static class CreateVH extends RecyclerView.ViewHolder {
        CreateVH(View itemView) {
            super(itemView);
        }
    }

    static class StoryVH extends RecyclerView.ViewHolder {
        ImageView storyThumb;
        TextView storyName;

        StoryVH(View itemView) {
            super(itemView);
            storyThumb = itemView.findViewById(R.id.storyThumb);
            storyName = itemView.findViewById(R.id.storyName);
        }
    }
}
