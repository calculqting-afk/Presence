# Student Checkout Fix

- Safely handle older student profiles without a role field in the Firestore attendance permission helper. The corrected rules have been deployed.
- Newly added and approved student accounts explicitly save the student role.
- Checkout errors provide clearer guidance instead of assuming the deployed rules are outdated.

Download **Presence.apk** and install it over your existing app. **Do not uninstall first.** Version **1.8.1**, version code **10**, retains the existing signing identity for updates.

The deployed rules apply to existing app versions too. Students still need an active account, a valid saved check-in, an open checkout window, and the required location checks.

Validation: 238 application tests and local Firestore emulator regression checks passed, including checkout with a missing role field, student permission restrictions, morning/afternoon saves, and circle-radius limits. Real-phone checkout should be retried after installation.

This remains the GitHub-distributed beta using the existing debug signing certificate. Play Protect may still show a warning; do not disable it.
