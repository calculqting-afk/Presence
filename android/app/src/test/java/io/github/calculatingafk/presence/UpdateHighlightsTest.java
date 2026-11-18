package io.github.calculatingafk.presence;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateHighlightsTest {
    @Test public void fullReleaseNotesShowOnlyThreeFeatureBullets() {
        String notes = "# Presence\n## What’s new\n- One\n- Two\n- Three\n- Four\n## Installation\n- Install APK\n## Validation\n- Tests passed";
        assertEquals("• One\n\n• Two\n\n• Three", UpdateHighlights.format(notes));
    }
    @Test public void excludesSetupAndFormatsCuratedHighlights() {
        assertEquals("• New feature", UpdateHighlights.format("• **New feature**\n## Installation\n- Install APK"));
        assertEquals("• Read more", UpdateHighlights.format("- [Read more](https://example.com)"));
        assertFalse(UpdateHighlights.format("## Validation\n- Tests passed").contains("Tests"));
        assertFalse(UpdateHighlights.format(null).isEmpty());
    }
    @Test public void longLegacyBulletsAreBounded() {
        String result = UpdateHighlights.format("- " + "A".repeat(500));
        assertTrue(result.length() <= 142);
        assertTrue(result.endsWith("…"));
    }
}
