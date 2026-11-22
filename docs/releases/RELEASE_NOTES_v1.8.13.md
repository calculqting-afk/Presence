# Presence v1.8.13

- Faster sign-in with fewer token refreshes and parallel backend checks.
- Fixed duplicate Firestore initialization during dashboard startup.
- Online status follows the authorized device session; stale browser records cannot override logout.
- Logout now waits for server confirmation and allows retry on failure.
- Stops dashboard startup when the device session ends during loading.
- Multiple tabs on one device no longer appear as multiple devices.
- Interactive Presence mascot with event guidance, speech bubbles and tap reactions.

Existing attendance records, account roles and device-transfer protections are preserved.
