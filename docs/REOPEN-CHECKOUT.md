# Reopen a finished checkout window

An admin with event-management permission can open the event from Past Events, extend its checkout cutoff beyond both the previous cutoff and the current time, then confirm the change. This reopens checkout only, on the original event date.

- The date, check-in opening/cutoff, checkout opening, session identity and participant roster stay locked.
- Morning cannot extend into its linked afternoon session. Yesterday's event cannot be reopened by choosing a time today; the event date remains unchanged.
- A reopened session is marked `checkoutOnlyReopened: true`. This marker cannot be removed through normal event updates.
- Students with a saved, incomplete check-in can check out within the new window. New check-ins and checkout-only/partial attendance are blocked by both client policy and Firestore Rules.
- Completed attendance cannot be checked out again. Saved timestamps, arrival labels, corrections and fine amounts/statuses are not rewritten. Existing fines may need separate admin review.
- Reopened events return to Events until the new cutoff. Report classifications may become pending while a session is open; these are projections, not deleted attendance records.
- Further reopening is by another cutoff extension only. Other time windows remain locked even while the reopened session is active.

## Deployment and testing

Publish the updated Firestore Rules before using this feature:

```powershell
firebase.cmd deploy --only firestore:rules --project presence-a873f
```

Publish the web source separately. Android needs a rebuilt APK for the updated form, checkout-only messaging and client guards. No Functions or Blaze upgrade is required; normal Firestore quotas apply.

Test on a same-day event with a finished checkout window: cancel the extension first (no write), then confirm it. Verify a student with an unfinished check-in can check out, a completed record cannot repeat checkout, and a student without a check-in cannot create attendance. Verify the event closes again at its new cutoff and other schedule fields/participants remain protected. For linked sessions, verify the morning/afternoon non-overlap rule.
