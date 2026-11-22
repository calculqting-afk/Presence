Presence v1.8.23 improves password reset, mobile account controls, and geofence saving:

- Pause background syncing during admin password confirmation and student password setup, then restore syncing only after the session is confirmed.
- Replace the old admin login reference after session renewal so directory refreshes use the current authenticated session.
- Preserve genuine access errors and provide recovery guidance if password setup succeeds but session restoration fails.
- Add an Account role selector and Change role button to student profiles on mobile, using the existing permissions, reason, confirmation, and audited save process.
- Avoid redundant event updates when saving attendance areas and reduce Firestore Rules evaluation work for geofence saves without removing authorization checks.

Install this APK over the existing version. The existing beta signing identity is retained for compatible updates. Server attendance records are preserved.

Automated checks cover these changes. Physical-device installation, password reset, mobile role changes, and attendance still require acceptance testing. This is the compatible beta distribution build, not a new production signing identity.
