# Optional During attendance

Each saved Morning or Afternoon session can enable one supplementary presence checkpoint. Under Modify Events, use **During attendance · Off/On**, choose a label and PH opening/closing times, and save. It defaults off. Configure it before the event or while ongoing, with future times ending no later than checkout opening. Settings lock once the checkpoint opens.

Students with a saved check-in can use **Confirm during attendance** in Events while the checkpoint is open. Face registration is required; sessions with an attendance area also require a fresh, accurate GPS reading checked against the server boundary. Attendance administrators can instead select **During attendance** in the existing QR scanner, verify the student in person, and confirm. No additional QR issuance is required.

Checkpoint confirmation is server-timed, idempotent, and stored in `attendance/{uid}_{eventId}.duringAttendance`. It preserves check-in, arrival status, checkout, and duration. Clients cannot forge or erase the confirmation. A missed checkpoint displays **Missed · review**; the feature does not create fines or change ordinary attendance completion.

Configuration is stored in `events/{eventId}.duringAttendance`, with an audit entry and the existing push outbox. Push reminders at checkpoint opening target eligible, checked-in students with registered notification devices. Existing view-scoped event/attendance subscriptions provide screen updates; there is no checkpoint polling or countdown database traffic.

## Deployment

This feature requires coordinated deployment: updated Firestore Rules, the admin API Worker, the notifications Worker, and the website/Android assets. Deploy the Rules and Workers before distributing the client update. Existing sessions without a checkpoint require no migration.

## Acceptance checks

- Feature off: ordinary check-in and checkout behave as before, with no missed checkpoint warning.
- Configure Morning only: Afternoon remains unchanged; reject past, overlapping, or out-of-session windows.
- Checked-in student: confirm inside the window; retry produces no duplicate; missing check-in and completed attendance are rejected.
- Require GPS: test inside/outside, stale/coarse readings, and admin QR fallback.
- Scanner: verify Check-in, During attendance, and Check-out labels and identity confirmation.
- After confirmation: ordinary checkout and audited attendance correction preserve the checkpoint.
- Missing checkpoint: review badge appears after closing, without an automatically assigned fine.
- Devices with notifications enabled receive the opening reminder; physical device GPS, camera, notification, and APK testing remain necessary.
