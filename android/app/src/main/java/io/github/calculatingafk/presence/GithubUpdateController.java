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
    private GithubReleaseService.Release availableRelease, downloadingRelease;
    private UpdateDialog progressDialog;
    private long receivedBytes, totalBytes;
    private boolean verifying;
    private GithubReleaseService.Release failedRelease;
    private Exception downloadFailure;
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
        if (dialog != null) return;
        if (downloadingRelease != null) { showProgress(); return; }
        if (failedRelease != null) { showDownloadFailure(failedRelease, downloadFailure); return; }
        if (pendingApk != null && pendingRelease != null) { ready(); return; }
        if (availableRelease != null) { prompt(availableRelease); return; }
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
                    availableRelease = release;
                    if (active() && release != null) prompt(release);
                });
            } catch (Exception error) {
                Log.w("PresenceUpdates", "Update check unavailable; attendance remains accessible", error);
                activity.runOnUiThread(() -> busy = false);
            }
        });
    }

    private void prompt(GithubReleaseService.Release release) {
        availableRelease = null;
        UpdateDialog sheet = new UpdateDialog(activity, "A new update is ready", "Keep Presence up to date for a smoother experience.");
        sheet.release(release, true);
        sheet.button("Download update", true, () -> download(release));
        sheet.button("Later", false, () -> {});
        show(sheet.dialog);
    }

    private void showProgress() {
        progressDialog = new UpdateDialog(activity, "Downloading update", "You can continue using Presence while the update downloads.");
        progressDialog.downloading(receivedBytes, totalBytes, verifying);
        progressDialog.button("Continue using app", false, () -> {});
        show(progressDialog.dialog);
    }

    private void ready() {
        UpdateDialog sheet = new UpdateDialog(activity, "Ready to install", "Download verified. Android will ask you to confirm installation. After it finishes, reopen Presence and continue signing in.");
        sheet.release(pendingRelease, false);
        sheet.button("Install update", true, this::requestInstall);
        sheet.button("Later", false, () -> { pendingApk = null; pendingRelease = null; });
        show(sheet.dialog);
    }

    private void download(GithubReleaseService.Release release) {
        busy = true;
        failedRelease = null; downloadFailure = null;
        downloadingRelease = release; receivedBytes = 0; totalBytes = release.sizeBytes; verifying = false;
        // The download runs off the UI thread; students can keep using attendance.
        showProgress();
        worker.execute(() -> {
            try {
                File apk = releases.download(release, new File(activity.getCacheDir(), "updates"), (received, total) ->
                    activity.runOnUiThread(() -> {
                        receivedBytes = received; totalBytes = total;
                        if (active() && progressDialog != null && dialog == progressDialog.dialog)
                            progressDialog.downloading(received, total, false);
                    }));
                activity.runOnUiThread(() -> {
                    verifying = true;
                    if (active() && progressDialog != null && dialog == progressDialog.dialog)
                        progressDialog.downloading(receivedBytes, totalBytes, true);
                });
                verifyApk(apk, release);
                activity.runOnUiThread(() -> {
                    busy = false;
                    downloadingRelease = null;
                    pendingApk = apk; pendingRelease = release;
                    if (active()) ready();
                });
            } catch (Exception error) {
                Log.w("PresenceUpdates", "Update download or verification failed", error);
                activity.runOnUiThread(() -> {
                    busy = false;
                    downloadingRelease = null;
                    failedRelease = release; downloadFailure = error;
                    if (active()) showDownloadFailure(release, error);
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
            UpdateDialog sheet = new UpdateDialog(activity, "Allow Presence updates",
                "Android needs permission to install this update. Open settings, enable ‘Allow from this source’ for Presence, then return here to continue installation.");
            sheet.button("Open settings", true, () -> {
                    try {
                        permissionPending = true;
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName())));
                    } catch (RuntimeException error) {
                        permissionPending = false;
                        showMessage("Cannot open settings", "Open Android Settings and allow Presence to install unknown apps, then try again.");
                    }
                });
            sheet.button("Later", false, () -> { pendingApk = null; pendingRelease = null; });
            show(sheet.dialog);
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
        if (!active()) return;
        UpdateDialog sheet = new UpdateDialog(activity, title, message);
        sheet.button("OK", true, () -> {}); show(sheet.dialog);
    }
    private String downloadError(Exception error) {
        if (error instanceof SecurityException) return "This APK does not match the installed app’s package, version, or signing certificate. Installation was stopped. Contact your administrator for a compatible update.";
        if ("Update checksum mismatch".equals(error.getMessage())) return "The downloaded file failed verification. Retry the download. Your current app is unchanged.";
        return "The download could not finish. Check your internet connection and available storage, then retry. Your current app is unchanged.";
    }
    private void showDownloadFailure(GithubReleaseService.Release release, Exception error) {
        failedRelease = null; downloadFailure = null;
        UpdateDialog sheet = new UpdateDialog(activity, "Update not completed", downloadError(error));
        sheet.button("Retry download", true, () -> download(release));
        sheet.button("Continue using app", false, () -> {});
        show(sheet.dialog);
    }
    private void show(AlertDialog next) {
        if (!active()) return;
        if (dialog != null) dialog.dismiss();
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
