package io.github.calculatingafk.presence;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateCheckPolicyTest {
    @Test public void manualCheckBypassesOnlyTheSuccessfulFiveMinuteInterval() {
        UpdateCheckPolicy policy = new UpdateCheckPolicy();
        assertEquals(0, policy.remaining(1000, false));
        policy.succeeded(1000);
        assertEquals(299000, policy.remaining(2000, false));
        assertEquals(0, policy.remaining(2000, true));
        policy.failed(2000, 0);
        assertEquals(60000, policy.remaining(2000, false));
        assertEquals(60000, policy.remaining(2000, true));
        assertEquals(0, policy.remaining(62000, true));
    }
    @Test public void serverDelaySurvivesManualChecksAndSuccessResetsFailure() {
        UpdateCheckPolicy policy = new UpdateCheckPolicy();
        policy.failed(1000, 900000);
        assertTrue(policy.failed);
        assertEquals(840000, policy.remaining(61000, true));
        assertEquals(840000, policy.remaining(61000, false));
        policy.succeeded(902000);
        assertFalse(policy.failed);
        assertEquals(0, policy.remaining(902000, true));
        assertEquals(300000, policy.remaining(902000, false));
    }
    @Test public void parsesServerRetrySecondsDatesAndRateLimitReset() {
        assertEquals(120000, GithubReleaseService.retryDelay("120", null, 0));
        assertEquals(120000, GithubReleaseService.retryDelay("Thu, 01 Jan 1970 00:02:00 GMT", null, 0));
        assertEquals(179000, GithubReleaseService.retryDelay("60", "180", 1000));
        assertEquals(0, GithubReleaseService.retryDelay(null, null, 1000));
        assertEquals(0, GithubReleaseService.retryDelay("-4", "0", 1000));
        assertEquals(0, GithubReleaseService.retryDelay("invalid", "invalid", 1000));
    }
}
