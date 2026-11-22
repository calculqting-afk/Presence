Presence v1.8.15 reduces repeated Firestore reads and fixes the stale Android package that could fail during Firestore initialization.

Changes
- D1 now handles frequent online-status heartbeats and shares the student directory read cache. Opening a profile loads that student's attendance history in pages rather than downloading everyone's history.
- Account Approval and Correction Request navigation badges use pending-count queries while closed. Full requests subscribe only when their page is visible; background counts refresh at most every five minutes.
- Activity History pages and organizer survey response pages now use shared D1 read models. Activity pages refresh within five minutes and survey pages within one minute; organizer edits invalidate the survey cache immediately when available.
- Approval decisions, attendance corrections, survey submissions and audit writes retain their existing Firestore transactions and permissions. This gradual migration does not provide automatic failover for all Firestore features.
- The rebuilt APK includes the shared Firebase runtime guard and all current website modules.

Validation
- 476 automated tests passed; JavaScript syntax and local imports checked.
- Worker deployed and D1 migration applied; student attendance-history index deployed.
- Android version 1.8.15 (24), same signing certificate. Every one of the 166 public files inside the fresh APK matches the synced source; private credential patterns checked.

Install Presence.apk over your existing installation. Physical-device sign-in and attendance testing remains recommended after installation.
