package io.github.calculatingafk.presence;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Locale;

/** Native, scrollable updater UI. Release notes are plain text, never executable markup. */
final class UpdateDialog {
    private static final int WHITE = Color.rgb(239, 245, 255), MUTED = Color.rgb(174, 192, 216);
    final AlertDialog dialog;
    private final Activity activity;
    private final LinearLayout content, actions;
    private TextView progressText, stage;
    private ProgressBar progress;

    UpdateDialog(Activity activity, String title, String description) {
        this.activity = activity;
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(24), dp(24), dp(24), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(23, 40, 63)); background.setCornerRadius(dp(24));
        root.setBackground(background);
        ScrollView scroll = new ScrollView(activity); scroll.setFillViewport(false);
        content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        actions = new LinearLayout(activity); actions.setOrientation(LinearLayout.VERTICAL);
        root.addView(actions);
        text("PRESENCE  ·  APP UPDATE", 12, MUTED, true);
        text(title, 25, WHITE, true);
        text(description, 15, MUTED, false);
        dialog = new AlertDialog.Builder(activity).create();
        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window == null) return;
            window.setContentView(root);
            window.setBackgroundDrawableResource(android.R.color.transparent);
            int width = Math.min(activity.getResources().getDisplayMetrics().widthPixels - dp(32), dp(440));
            // Cap the sheet height so notes and large accessibility fonts remain scrollable.
            int height = (int) (activity.getResources().getDisplayMetrics().heightPixels * .82);
            window.setLayout(width, height);
        });
    }

    void release(GithubReleaseService.Release release, boolean notes) {
        text("Installed  " + BuildConfig.VERSION_NAME + "   →   New  " + release.versionName, 16, WHITE, true);
        if (release.sizeBytes > 0) text("Download size: " + size(release.sizeBytes), 14, MUTED, false);
        if (notes) {
            text("What’s new", 18, WHITE, true);
            text(UpdateHighlights.format(release.notes), 14, MUTED, false);
        }
    }

    void downloading(long received, long total, boolean verifying) {
        if (progress == null) {
            progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
            progress.setMax(100);
            progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(43, 125, 255)));
            content.addView(progress, new LinearLayout.LayoutParams(-1, dp(16)));
            progressText = text("", 22, WHITE, true);
            stage = text("", 14, MUTED, false);
        }
        progress.setIndeterminate(!verifying && total <= 0);
        int percent = total > 0 ? (int) Math.min(100, (double) received * 100 / total) : 0;
        progress.setProgress(verifying ? 100 : percent);
        progressText.setText(verifying ? "Download complete" : total > 0 ? percent + "% · " + size(received) + " of " + size(total) : size(received) + " downloaded");
        stage.setText(verifying ? "Verifying the update before installation…" : "Downloading securely. Installation will be available after verification.");
        progress.setContentDescription(progressText.getText());
    }

    void button(String label, boolean primary, Runnable action) {
        Button button = new Button(activity); button.setText(label); button.setAllCaps(false);
        button.setTextColor(WHITE); button.setTextSize(15);
        GradientDrawable bg = new GradientDrawable(); bg.setCornerRadius(dp(12));
        bg.setColor(primary ? Color.rgb(30, 109, 239) : Color.rgb(15, 31, 52));
        button.setBackground(bg); button.setMinHeight(dp(48));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(10);
        actions.addView(button, params);
        button.setOnClickListener(v -> { dialog.dismiss(); action.run(); });
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView text = new TextView(activity); text.setText(value); text.setTextSize(size);
        text.setTextColor(color); text.setLineSpacing(dp(3), 1);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(16);
        content.addView(text, params); return text;
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static String size(long bytes) { return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024)); }
}
