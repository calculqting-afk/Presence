# Dashboard performance

## Implemented optimizations

- Survey implementation/repository/location/deletion modules download on first survey use, not normal dashboard startup. A lightweight bridge preserves navigation and direct QR links. Leaving while loading and disposal ignore late initialization; failed imports can retry.
- The QR generator downloads only when Show QR is selected. The survey URL remains available if that download fails. Leaflet already loads on demand; its existing behavior is preserved.
- Student event cards, dashboard timeline, event history and attendance pages render only for their relevant views. Unchanged event-card and timeline markup retains its DOM and loading-button state.
- Student event/attendance feeds suspend on unrelated views. Admin student-directory feed suspends on views that do not need the directory. Complete student rosters still load for event publication; metadata confirmation remains required.
- Event lookups use Maps instead of repeated array scans. Directory search is debounced for 200 ms and its pending callback is cleared during disposal.
- Survey recent/archive requests run concurrently and refresh renders the picker once rather than twice.
- Unused student imports and the obsolete shared toastTimer export were removed. Attendance metadata notifications remain enabled for reliable cache/server confirmation; unrelated student feeds no longer request metadata-only notifications.

## Data correctness boundary

Full events/attendance are still loaded in views that require all-time attendance/absence summaries. They are not arbitrarily capped: doing that would make old absences and missed-checkout reviews incomplete. Admin attendance-history queries and survey response/event queries already use bounded cursor/query mechanisms. Fully replacing summary feeds with paginated queries requires a trustworthy summary source and legacy-data coverage design; that is not introduced here. No database rules, indexes or schema changes are required for these optimizations.

## Measurement

Use the browser Performance panel or the following read-only console expression:

```js
performance.getEntriesByType('measure')
  .filter(entry => entry.name.startsWith('presence:'))
  .map(entry => ({ stage: entry.name, milliseconds: Math.round(entry.duration) }));
```

Stage names include `startup` (application initialization), `profile` (verified profile/greeting), `events-first-data` (first student event snapshot), and `survey-module` (first lazy survey module download). These are local only and are not transmitted. Startup is not a claim that every Firebase record is ready. The first event snapshot may be cached. Profile timing includes authentication verification, not just a saved display preview. Survey-module timing excludes survey database queries.

No real-device before/after latency numbers were collected during implementation. Regression tests verify structural improvements: no SurveyController module at ordinary startup, one picker render per survey refresh, simultaneous independent reads, one DOM write for repeated identical event markup, suspended feeds on unrelated views, and one filter callback for a typing burst.

For actual comparisons, use the same device, connection and account; repeat five times and compare medians. Test cold and warm loads separately. Use Firebase usage/diagnostic tooling for actual billed reads rather than inferring them solely from listener counts.

## Smoke tests

1. Hard-refresh and sign in as student and each manager role. Verify profile and attendance totals.
2. Switch Dashboard → Events → Profile → Events; confirm current event buttons and their pending spinners remain correct.
3. Open Surveys for the first time, navigate away during loading, and return. Confirm only one survey section and working responses.
4. Follow a QR deep link while signed in and through login. Generate QR on a GitHub Pages project path.
5. Type rapidly in student search; change filters and pages; confirm latest results.
6. Publish an event after visiting another panel. Confirm complete participant roster and readiness validation.
7. Review historical attendance, absences and missed checkouts. Confirm unchanged totals and historical roster sections.
