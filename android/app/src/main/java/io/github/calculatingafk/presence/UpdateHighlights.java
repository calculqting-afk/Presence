package io.github.calculatingafk.presence;

import java.util.ArrayList;
import java.util.List;

/** Keep older full release notes readable without showing setup or test documentation. */
final class UpdateHighlights {
    static String format(String notes) {
        List<String> highlights = new ArrayList<>();
        for (String raw : (notes == null ? "" : notes).split("\\r?\\n")) {
            String line = raw.trim();
            if (line.matches("(?i)^#{1,6}\\s+(installation|validation|testing|security|download|requirements).*")) break;
            if (line.startsWith("#") && !highlights.isEmpty()) break;
            if (!line.matches("^[-*•]\\s+.*")) continue;
            line = line.replaceFirst("^[-*•]\\s+", "")
                .replaceAll("\\[([^\\]]+)\\]\\([^)]*\\)", "$1")
                .replace("**", "").replace("`", "").trim();
            if (line.isEmpty()) continue;
            if (line.length() > 140) line = line.substring(0, 137).trim() + "…";
            highlights.add("• " + line);
            if (highlights.size() == 3) break;
        }
        return highlights.isEmpty() ? "Improvements and fixes for a smoother experience." : String.join("\n\n", highlights);
    }
}
