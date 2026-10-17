# Presence v1.6 - Live Attendance Reports

- Added live attendance report previews in Admin > Attendance Line.
- Export all matching students to an A4 portrait PDF, with totals, readable dates and page numbers.
- Added event check-in/out times and cutoffs to each PDF page footer.
- Added Android Save PDF and Share PDF dialogs.
- Deleted/missing student profiles now remain visible for review with their historical section, rather than counting as confirmed absences.
- Offline or unverified data blocks PDF export to avoid incomplete reports. Downloaded PDFs are fixed snapshots.

## Publishing checklist

- Tag: `v1.6.0`; Android version **1.6**, version code **7**.
- Upload `Presence.apk` and `presence-update.json` from the same build in `android/app/build/outputs/apk/beta/`.
- Keep the exact asset names; publish only after both uploads complete.
- This beta retains the existing local debug signing identity for compatibility with previously distributed APKs. It is not a Google Play production build.
- First install over the current APK on a phone without uninstalling. Confirm login/data retention, live report updates, portrait PDF footer, save destination, save cancellation and sharing to a trusted app.
- No Firebase rules/Functions deployment or Blaze upgrade is required. Normal Firestore quotas still apply.
- Local build verification does not replace real-device acceptance testing. Building does not publish GitHub or deploy Firebase.
