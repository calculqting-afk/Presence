# Time since and ongoing schedule editing

## TIME SINCE

Admin Dashboard > Live attendance and Attendance Line retain exact IN/OUT
timestamps. Beneath each recorded timestamp they also show Checked in/out
just now, N min ago, N hr ago, or N days ago. Missing/pending timestamps and
synthetic absences have no invented time-since label. Checkout-only records
show only a checkout label. Deleted profiles retain labels for actual records.

Labels refresh in the browser once per minute while the document is visible,
and immediately on focus, visibility restoration and view changes. Hidden view
rows are not repainted. Disposal cancels timers and listeners. Refreshing these
labels does not fetch data, redraw the history query, or write to Firestore.
It uses recorded attendance timestamps, not the last metadata edit time. If a
timestamp is significantly ahead of the device clock, it shows Time unavailable
instead of a negative or misleading elapsed interval. Duration remains the
recorded interval between IN and OUT, not continuous-presence verification.
PDF exports keep exact timestamps; they do not embed ticking relative labels.

## Editing a running session

Super, Head and Attendance Admins retain their existing event-management
permissions. While a session is ongoing, all four time fields are editable.
Saving changed times opens a focus-contained confirmation dialog. Cancel or
Escape performs no writes or notifications. Participant-only/metadata edits
do not prompt for a schedule change. The confirmation warns that an earlier
checkout cutoff can end attendance immediately.

After saving, subsequent check-ins and checkouts follow the new server-side
schedule. Student event listeners refresh the schedules/buttons. Existing IN,
OUT, attendedAt, arrivalStatus and lifecycle status are not overwritten by
event metadata synchronization. Existing Present/Late and Completed records
are not reclassified. Current availability, pending/absence projections and
missed-checkout indicators still follow the current schedule; those are not
new stored attendance records. Changing an individual recorded status remains
a separate manual correction action.

Morning and afternoon must remain ordered and non-overlapping. Existing
legacy cutoff aliases are updated along with the new cutoff, independently
for each session. Event date and session identity/mode remain protected after
opening. Closed participant groups stay locked. Closed sessions may now extend
only their checkout cutoff, with confirmation and existing-check-in-only access;
see [Reopen checkout](REOPEN-CHECKOUT.md). Firestore rules enforce role,
window order, session linkage, overlap, date and closed-session constraints.

## Deployment

Publish the updated rules before using ongoing time edits:

```powershell
firebase.cmd deploy --only firestore:rules --project presence-a873f
```

Publish the web files and hard-refresh. Android needs a new versionCode and APK
build; do not replace the published v1.7 assets or manifest. This feature does
not require Cloud Functions or Blaze. No deployment or release publication is
performed by implementing/building the web code.

Test an ongoing session: cancel an edit, then confirm an edit; check recorded
timestamps/statuses remain intact, a new student follows the new cutoff, and
an existing student checks out using the updated window. Verify an overlap,
an opened-event date change, a student write and a closed-session time change
are rejected. Verify labels advance after a minute, pause when backgrounded,
resume on return, and do not change exact timestamps or duration.
