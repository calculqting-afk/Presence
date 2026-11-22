# Presence v1.8.14

- Dashboard live attendance queries today, retaining unfinished overnight sessions.
- Attendance Line filters the selected event and its session pair in Firestore.
- Presence queries exclude old inactive browser records.
- Notifications show the latest 100, reuse active subscriptions and use bounded retry backoff.
- Quick navigation reuses selected listeners for 15 seconds.
- Expired-password background cleanup runs every five minutes; password completion checks exact expiry.

Historical attendance remains available. Permissions and device-session protection are preserved. These changes reduce future reads; they do not reset an already exhausted Firebase quota.
