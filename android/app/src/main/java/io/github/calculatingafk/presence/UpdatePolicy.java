package io.github.calculatingafk.presence;

import java.net.URI;

/** Pure release policy, shared by discovery and APK verification. */
public final class UpdatePolicy {
    public static final String REPOSITORY = "calculqting-afk/Presencee";

    private UpdatePolicy() {}

    public static boolean isReleaseAsset(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost())
                && uri.getUserInfo() == null && uri.getPort() == -1
                && uri.getPath().startsWith("/" + REPOSITORY + "/releases/download/");
        } catch (RuntimeException error) { return false; }
    }

    public static boolean isDownloadHost(String url) {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
                && uri.getPort() == -1 && ("github.com".equals(host)
                || "release-assets.githubusercontent.com".equals(host)
                || "objects.githubusercontent.com".equals(host) || "api.github.com".equals(host));
        } catch (RuntimeException error) { return false; }
    }

    public static boolean isNewer(long candidate, long installed) { return candidate > installed; }

    public static boolean isSha256(String value) {
        return value != null && value.matches("[a-fA-F0-9]{64}");
    }
}
