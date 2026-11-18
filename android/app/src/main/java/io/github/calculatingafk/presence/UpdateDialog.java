package io.github.calculatingafk.presence;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.view.Window;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Locale;

/** Native, scrollable updater UI. Release notes are plain text, never executable markup. */
final class UpdateDialog {
    private static final int WHITE = Color.rgb(239, 245, 255), MUTED = Color.rgb(174, 192, 216);
    final AlertDialog dialog;
    private final Activity activity;
    private final LinearLayout content, actions;
    private TextView progressText, stage, downloadStep, installStep;
    private ProgressRing progress;

    UpdateDialog(Activity activity, String title, String description) {
        this.activity = activity;
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(24), dp(24), dp(24), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(9, 21, 37)); background.setCornerRadius(dp(24));
        root.setBackground(background);
        ScrollView scroll = new ScrollView(activity); scroll.setFillViewport(false);
        content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        actions = new LinearLayout(activity); actions.setOrientation(LinearLayout.VERTICAL);
        root.addView(actions);
        LinearLayout brand = new LinearLayout(activity); brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = new ImageView(activity); logo.setImageResource(activity.getApplicationInfo().icon);
        logo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        brand.addView(logo, new LinearLayout.LayoutParams(dp(38), dp(38)));
        TextView name = label("Presence", 23, WHITE, true); name.setPadding(dp(12), 0, 0, 0);
        brand.addView(name);
        LinearLayout.LayoutParams brandParams = new LinearLayout.LayoutParams(-1, -2); brandParams.bottomMargin = dp(24);
        content.addView(brand, brandParams);
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
            int height = (int) (activity.getResources().getDisplayMetrics().heightPixels * .90);
            window.setLayout(width, height);
        });
    }

    void release(GithubReleaseService.Release release, boolean notes) {
        LinearLayout versions = new LinearLayout(activity); versions.setGravity(Gravity.CENTER_VERTICAL);
        versions.addView(versionCard("Installed", BuildConfig.VERSION_NAME, WHITE), new LinearLayout.LayoutParams(0, -2, 1));
        TextView arrow = label("→", 24, MUTED, true); arrow.setGravity(Gravity.CENTER);
        versions.addView(arrow, new LinearLayout.LayoutParams(dp(40), -2));
        versions.addView(versionCard("New version", release.versionName, Color.rgb(100, 240, 163)), new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams versionParams = new LinearLayout.LayoutParams(-1, -2); versionParams.bottomMargin = dp(24);
        content.addView(versions, versionParams);
        if (notes) {
            text("What’s new", 18, WHITE, true);
            for (String highlight : UpdateHighlights.format(release.notes).split("\\n\\n")) {
                LinearLayout row = new LinearLayout(activity);
                TextView bullet = label("•", 20, Color.rgb(43, 139, 255), true);
                row.addView(bullet, new LinearLayout.LayoutParams(dp(22), -2));
                row.addView(label(highlight.replaceFirst("^•\\s*", ""), 15, WHITE, false), new LinearLayout.LayoutParams(0, -2, 1));
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(14);
                content.addView(row, params);
            }
        }
        if (release.sizeBytes > 0) {
            LinearLayout sizeRow = new LinearLayout(activity); sizeRow.setGravity(Gravity.CENTER_VERTICAL);
            sizeRow.setPadding(dp(14), dp(12), dp(14), dp(12)); sizeRow.setBackground(cardBackground());
            sizeRow.addView(label("Download size", 14, MUTED, false), new LinearLayout.LayoutParams(0, -2, 1));
            sizeRow.addView(label(size(release.sizeBytes), 15, WHITE, true));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(16);
            content.addView(sizeRow, params);
        }
        if (notes) text("✓  Your attendance records stay safe.", 13, MUTED, false);
    }

    void downloading(long received, long total, boolean verifying) {
        if (progress == null) {
            progress = new ProgressRing();
            LinearLayout.LayoutParams ringParams = new LinearLayout.LayoutParams(dp(200), dp(200));
            ringParams.gravity = Gravity.CENTER_HORIZONTAL; ringParams.bottomMargin = dp(20);
            content.addView(progress, ringParams);
            progressText = text("", 17, WHITE, true); progressText.setGravity(Gravity.CENTER);
            stage = text("", 14, MUTED, false);
            stage.setGravity(Gravity.CENTER);
            text("✓  Update found", 16, Color.rgb(100, 240, 163), true);
            downloadStep = text("", 16, WHITE, true);
            installStep = text("○  Ready to install", 16, MUTED, false);
        }
        int percent = total > 0 ? (int) Math.min(100, (double) received * 100 / total) : 0;
        progress.setProgress(verifying ? 100 : percent, !verifying && total <= 0);
        progressText.setText(verifying ? "Download complete" : total > 0 ? size(received) + " of " + size(total) : size(received) + " downloaded");
        stage.setText(verifying ? "Verifying the update before installation…" : "You can continue using Presence while it downloads.");
        downloadStep.setText(verifying ? "✓  Downloaded" : "●  Downloading");
        downloadStep.setTextColor(verifying ? Color.rgb(100, 240, 163) : Color.rgb(43, 139, 255));
        installStep.setText(verifying ? "○  Verifying before installation" : "○  Ready to install");
        progress.setContentDescription((!verifying && total > 0 ? percent + " percent. " : "") + progressText.getText());
    }

    void button(String label, boolean primary, Runnable action) {
        Button button = new Button(activity); button.setText(label); button.setAllCaps(false);
        button.setTextColor(WHITE); button.setTextSize(16); button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable bg = new GradientDrawable(); bg.setCornerRadius(dp(12));
        boolean later = "Later".equals(label);
        bg.setColor(primary ? Color.rgb(18, 111, 255) : Color.TRANSPARENT);
        if (!primary && !later) bg.setStroke(dp(1), MUTED);
        button.setBackground(bg); button.setMinHeight(dp(48));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(10);
        actions.addView(button, params);
        button.setOnClickListener(v -> { dialog.dismiss(); action.run(); });
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView text = label(value, size, color, bold);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(16);
        content.addView(text, params); return text;
    }
    private TextView label(String value, int size, int color, boolean bold) {
        TextView text = new TextView(activity); text.setText(value); text.setTextSize(size);
        text.setTextColor(color); text.setLineSpacing(dp(3), 1);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return text;
    }
    private GradientDrawable cardBackground() {
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.rgb(25, 44, 66));
        bg.setCornerRadius(dp(14)); bg.setStroke(dp(1), Color.rgb(44, 65, 88)); return bg;
    }
    private LinearLayout versionCard(String title, String version, int color) {
        LinearLayout card = new LinearLayout(activity); card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14)); card.setBackground(cardBackground());
        card.addView(label(title, 14, MUTED, false)); card.addView(label(version, 23, color, true));
        return card;
    }
    private final class ProgressRing extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int percent;
        private boolean unknown;
        ProgressRing() { super(activity); setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES); }
        void setProgress(int value, boolean unknown) { percent = value; this.unknown = unknown; invalidate(); }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float stroke = dp(13), radius = Math.min(getWidth(), getHeight()) / 2f - stroke;
            float x = getWidth() / 2f, y = getHeight() / 2f;
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(stroke); paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setColor(Color.rgb(37, 56, 79)); canvas.drawCircle(x, y, radius, paint);
            paint.setColor(Color.rgb(18, 111, 255));
            canvas.drawArc(new RectF(x - radius, y - radius, x + radius, y + radius), -90, unknown ? 70 : percent * 3.6f, false, paint);
            paint.setStyle(Paint.Style.FILL); paint.setColor(WHITE); paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(38 * getResources().getDisplayMetrics().scaledDensity); paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(unknown ? "…" : percent + "%", x, y - (paint.ascent() + paint.descent()) / 2, paint);
        }
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static String size(long bytes) { return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024)); }
}
