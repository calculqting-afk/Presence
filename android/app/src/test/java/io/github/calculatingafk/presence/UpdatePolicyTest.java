package io.github.calculatingafk.presence;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    @Test public void acceptsOnlyOurReleaseAssets() {
        assertTrue(UpdatePolicy.isReleaseAsset("https://github.com/calculqting-afk/Presencee/releases/download/v1.3/Presence.apk"));
        assertFalse(UpdatePolicy.isReleaseAsset("http://github.com/calculqting-afk/Presencee/releases/download/v1/Presence.apk"));
        assertFalse(UpdatePolicy.isReleaseAsset("https://github.com/attacker/Presencee/releases/download/v1/Presence.apk"));
        assertFalse(UpdatePolicy.isReleaseAsset("https://github.com.evil.test/calculqting-afk/Presencee/releases/download/v1/a"));
        assertFalse(UpdatePolicy.isReleaseAsset(null));
    }
    @Test public void rejectsInsecureAndUntrustedRedirects() {
        assertTrue(UpdatePolicy.isDownloadHost("https://release-assets.githubusercontent.com/asset?token=x"));
        assertFalse(UpdatePolicy.isDownloadHost("http://release-assets.githubusercontent.com/asset"));
        assertFalse(UpdatePolicy.isDownloadHost("https://evil.test/Presence.apk"));
        assertFalse(UpdatePolicy.isDownloadHost("https://user@github.com/a"));
    }
    @Test public void requiresHigherVersionAndValidHash() {
        assertTrue(UpdatePolicy.isNewer(4, 3));
        assertFalse(UpdatePolicy.isNewer(3, 3));
        assertFalse(UpdatePolicy.isNewer(2, 3));
        assertTrue(UpdatePolicy.isSha256("a".repeat(64)));
        assertFalse(UpdatePolicy.isSha256("z".repeat(64)));
        assertFalse(UpdatePolicy.isSha256(null));
    }
}
