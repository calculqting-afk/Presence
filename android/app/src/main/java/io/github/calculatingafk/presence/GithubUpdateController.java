package io.github.calculatingafk.presence;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Owns non-blocking update prompts and the explicit Android installation handoff. */
public final class GithubUpdateController {
    private final Activity activity;
    private final GithubReleaseService releases;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean disposed, busy, permissionPending, foreground;
    private long lastCheck = -1;
    private File pendingApk;
    private GithubReleaseService.Release pendingRelease;
    private AlertDialog dialog;

    public GithubUpdateController(Activity activity) { this(activity, new GithubReleaseService()); }
    GithubUpdateController(Activity activity, GithubReleaseService releases) {
        this.activity = activity; this.releases = releases;
    }

    public void checkOnResume() {
        foreground = true;
        if (!BuildConfig.DISTRIBUTION_UPDATES || !active()) return;
        if (permissionPending) {
            permissionPending = false;
            if (canInstall()) install();
            else showMessage("Update not installed", "Installation permission was not enabled. You can try again when Presence next checks for updates.");
            return;
        }
        if (busy || dialog != null) return;
        long now = SystemClock.elapsedRealtime();
        if (lastCheck >= 0 && now - lastCheck < 300000) return;
        lastCheck = now;
        busy = true;
        worker.execute(() -> {
            try {
                GithubReleaseService.Release release = releases.findUpdate(BuildConfig.VERSION_CODE);
                activity.runOnUiThread(() -> {
                    busy = false;
                    if (active() && release != null) prompt(release);
                });
            } catch (Exception error) {
                Log.w("PresenceUpdates", "Update check unavailable; attendance remains accessible", error);
                activity.runOnUiThread(() -> busy = false);
            }
        });
    }

    private void prompt(GithubReleaseService.Release release) {
        show(new AlertDialog.Builder(activity).setTitle("Presence update available")
            .setMessage("Version " + release.versionName + " is ready. Download and update without uninstalling. Android will ask you to confirm installation.")
            .setNegativeButton("Later", null)
            .setPositiveButton("Download update", (d, which) -> download(release)).create());
    }

    private void download(GithubReleaseService.Release release) {
        busy = true;
        // The download runs off the UI thread; students can keep using attendance.
        android.widget.Toast.makeText(activity, "Downloading Presence update…", android.widget.Toast.LENGTH_LONG).show();
        worker.execute(() -> {
            try {
                File apk = releases.download(release, new File(activity.getCacheDir(), "updates"));
                verifyApk(apk, release);
                activity.runOnUiThread(() -> {
                    busy = false;
                    if (!active()) return;
                    pendingApk = apk; pendingRelease = release;
                    show(new AlertDialog.Builder(activity).setTitle("Presence update ready")
                        .setMessage("Download verified. Install the update now?")
                        .setNegativeButton("Later", null)
                        .setPositiveButton("Install", (d, which) -> requestInstall()).create());
                });
            } catch (Exception error) {
                Log.w("PresenceUpdates", "Update download or verification failed", error);
                activity.runOnUiThread(() -> {
                    busy = false;
                    if (active()) showMessage("Unable to update", "The download could not be verified or completed. Your current app is unchanged. Please try again later.");
                });
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void verifyApk(File apk, GithubReleaseService.Release release) throws Exception {
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(activity.getPackageName(), flags);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)) throw new SecurityException("Wrong APK package");
        long code = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        if (code != release.versionCode || !UpdatePolicy.isNewer(code, BuildConfig.VERSION_CODE)) throw new SecurityException("Wrong APK version");
        Signature[] incoming = Build.VERSION.SDK_INT >= 28 ? candidate.signingInfo.getApkContentsSigners() : candidate.signatures;
        Signature[] current = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        if (incoming == null || incoming.length == 0 || !Arrays.equals(incoming, current)) throw new SecurityException("Wrong signing certificate");
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void requestInstall() {
        if (!canInstall()) {
            show(new AlertDialog.Builder(activity).setTitle("Allow Presence updates")
                .setMessage("Android requires permission to install updates from Presence. Enable ‘Allow from this source’, then return here. No Google sign-in is needed.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Open settings", (d, which) -> {
                    try {
                        permissionPending = true;
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName())));
                    } catch (RuntimeException error) {
                        permissionPending = false;
                        showMessage("Cannot open settings", "Open Android Settings and allow Presence to install unknown apps, then try again.");
                    }
                }).create());
        } else install();
    }

    private void install() {
        try {
            if (pendingApk == null || pendingRelease == null) return;
            verifyApk(pendingApk, pendingRelease);
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", pendingApk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
        } catch (Exception error) {
            Log.w("PresenceUpdates", "Cannot open Android installer", error);
            showMessage("Unable to open installer", "The update was not installed. Please try again later.");
        }
    }

    private void showMessage(String title, String message) {
        if (active()) show(new AlertDialog.Builder(activity).setTitle(title).setMessage(message).setPositiveButton("OK", null).create());
    }
    private void show(AlertDialog next) {
        if (!active()) return;
        dialog = next;
        next.setOnDismissListener(d -> { if (dialog == next) dialog = null; });
        next.show();
    }
    public void onPause() {
        foreground = false;
        if (dialog != null) dialog.dismiss();
    }
    private boolean active() { return foreground && !disposed && !activity.isFinishing() && !activity.isDestroyed(); }
    public void dispose() {
        disposed = true;
        if (dialog != null) dialog.dismiss();
        worker.shutdownNow();
    }
}
