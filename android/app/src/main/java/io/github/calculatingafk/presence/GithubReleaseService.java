package io.github.calculatingafk.presence;

import org.json.JSONArray;
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
        Release(long code, String name, String url, String hash) {
            versionCode = code; versionName = name; apkUrl = url; sha256 = hash;
        }
    }

    public Release findUpdate(long installed) throws Exception {
        JSONArray releases = new JSONArray(readText("https://api.github.com/repos/"
            + UpdatePolicy.REPOSITORY + "/releases?per_page=20", 2 * 1024 * 1024));
        Release newest = null;
        for (int i = 0; i < releases.length(); i++) {
            JSONObject release = releases.getJSONObject(i);
            if (release.optBoolean("draft")) continue;
            JSONArray assets = release.optJSONArray("assets");
            if (assets == null) continue;
            String manifestUrl = null, apkUrl = null;
            for (int j = 0; j < assets.length(); j++) {
                JSONObject asset = assets.getJSONObject(j);
                if ("presence-update.json".equals(asset.optString("name"))) manifestUrl = asset.optString("browser_download_url");
                if ("Presence.apk".equals(asset.optString("name"))) apkUrl = asset.optString("browser_download_url");
            }
            if (!UpdatePolicy.isReleaseAsset(manifestUrl) || !UpdatePolicy.isReleaseAsset(apkUrl)) continue;
            try {
                JSONObject manifest = new JSONObject(readText(manifestUrl, 16384));
                long code = manifest.getLong("versionCode");
                String hash = manifest.getString("sha256");
                if (!BuildConfig.APPLICATION_ID.equals(manifest.getString("packageId"))
                    || !UpdatePolicy.isSha256(hash) || !UpdatePolicy.isNewer(code, installed)) continue;
                if (newest == null || code > newest.versionCode)
                    newest = new Release(code, manifest.getString("versionName"), apkUrl, hash);
            } catch (Exception ignored) {
                // A malformed/incomplete release must not hide other valid releases.
            }
        }
        return newest;
    }

    public File download(Release release, File directory) throws Exception {
        if (!UpdatePolicy.isReleaseAsset(release.apkUrl)) throw new IOException("Untrusted update URL");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Cannot create update folder");
        File file = new File(directory, "Presence-update.apk");
        HttpURLConnection connection = connect(release.apkUrl);
        boolean success = false;
        try {
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
                }
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
            if (status != 200) { connection.disconnect(); throw new IOException("Update server returned " + status); }
            return connection;
        }
        throw new IOException("Too many download redirects");
    }
}
