package io.github.calculatingafk.presence;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/** Reads public releases without credentials and downloads bounded HTTPS assets. */
public final class GithubReleaseService {
    private static final long MAX_APK_BYTES = 150L * 1024 * 1024;

    public static final class Release {
        public final long versionCode;
        public final String versionName, apkUrl, sha256;
        public final String notes;
        public final long sizeBytes;
        Release(long code, String name, String url, String hash) {
            this(code, name, url, hash, "", 0);
        }
        Release(long code, String name, String url, String hash, String notes, long sizeBytes) {
            versionCode = code; versionName = name; apkUrl = url; sha256 = hash;
            this.notes = notes; this.sizeBytes = sizeBytes;
        }
    }

    public Release findUpdate(long installed) throws Exception {
        // One bounded manifest request, following GitHub's latest stable release redirect.
        JSONObject manifest = new JSONObject(readText("https://github.com/" + UpdatePolicy.REPOSITORY
            + "/releases/latest/download/presence-update.json", 16384));
        return parseManifest(manifest, installed);
    }

    Release parseManifest(JSONObject manifest, long installed) throws Exception {
        long code = manifest.getLong("versionCode");
        String name = manifest.getString("versionName"), hash = manifest.getString("sha256");
        if (!BuildConfig.APPLICATION_ID.equals(manifest.getString("packageId")) || code < 1
            || !UpdatePolicy.isSha256(hash) || !name.matches("[0-9]+(?:\\.[0-9]+){1,3}"))
            throw new IOException("Invalid update information");
        // Older manifests have no URL/size/notes. Derive the immutable tagged APK URL.
        String url = manifest.optString("apkUrl", "https://github.com/" + UpdatePolicy.REPOSITORY
            + "/releases/download/v" + name + "/Presence.apk");
        if (!UpdatePolicy.isReleaseAsset(url)) throw new IOException("Invalid update information");
        if (!UpdatePolicy.isNewer(code, installed)) return null;
        return new Release(code, name, url, hash, manifest.optString("notes", ""), manifest.optLong("sizeBytes", 0));
    }

    public static final class HttpFailure extends IOException {
        public final int status;
        public final long retryMillis;
        HttpFailure(int status, long retryMillis) {
            super("Update server returned " + status); this.status = status; this.retryMillis = retryMillis;
        }
    }

    static long retryDelay(String value, String reset, long now) {
        long delay = 0;
        try { delay = Math.multiplyExact(Long.parseLong(value), 1000); }
        catch (Exception ignored) {
            try {
                java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US);
                format.setTimeZone(java.util.TimeZone.getTimeZone("GMT"));
                delay = format.parse(value).getTime() - now;
            } catch (Exception invalid) { /* No valid Retry-After header. */ }
        }
        try { delay = Math.max(delay, Math.subtractExact(Math.multiplyExact(Long.parseLong(reset), 1000), now)); }
        catch (Exception ignored) { /* No valid rate-limit reset header. */ }
        return Math.max(0, delay);
    }

    public File download(Release release, File directory) throws Exception {
        return download(release, directory, (received, total) -> {});
    }

    public interface Progress { void update(long received, long total); }

    public File download(Release release, File directory, Progress progress) throws Exception {
        if (!UpdatePolicy.isReleaseAsset(release.apkUrl)) throw new IOException("Untrusted update URL");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Cannot create update folder");
        File file = new File(directory, "Presence-update.apk");
        HttpURLConnection connection = connect(release.apkUrl);
        boolean success = false;
        try {
            long expected = connection.getContentLengthLong();
            if (expected <= 0) expected = release.sizeBytes;
            long lastProgress = 0;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                byte[] buffer = new byte[32768];
                long total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Download cancelled");
                    total += count;
                    if (total > MAX_APK_BYTES) throw new IOException("Update is too large");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                    long now = System.nanoTime();
                    if (now - lastProgress >= 200000000L) {
                        progress.update(total, expected); lastProgress = now;
                    }
                }
                progress.update(total, expected);
            }
            StringBuilder hash = new StringBuilder();
            for (byte value : digest.digest()) hash.append(String.format("%02x", value & 255));
            if (!release.sha256.equalsIgnoreCase(hash.toString())) throw new IOException("Update checksum mismatch");
            success = true;
            return file;
        } finally {
            connection.disconnect();
            if (!success) file.delete();
        }
    }

    private String readText(String url, int limit) throws Exception {
        HttpURLConnection connection = connect(url);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Check cancelled");
                if (output.size() + count > limit) throw new IOException("Release metadata is too large");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        } finally { connection.disconnect(); }
    }

    private HttpURLConnection connect(String address) throws Exception {
        for (int redirects = 0; redirects < 6; redirects++) {
            if (!UpdatePolicy.isDownloadHost(address)) throw new IOException("Untrusted download host");
            HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "Presence-Android-Updater");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Missing download redirect");
                address = new URL(new URL(address), location).toString();
                continue;
            }
            if (status != 200) {
                long delay = retryDelay(connection.getHeaderField("Retry-After"),
                    connection.getHeaderField("X-RateLimit-Reset"), System.currentTimeMillis());
                connection.disconnect(); throw new HttpFailure(status, delay);
            }
            return connection;
        }
        throw new IOException("Too many download redirects");
    }
}
