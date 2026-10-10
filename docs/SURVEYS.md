# Event surveys (Spark-compatible browser evidence)

## Admin setup

1. Create a normal event with an enabled circle or polygon attendance area.
2. As Super Admin, Head Admin or Attendance Manager, open **Event Surveys**, or **Survey / QR** on the event card.
3. Choose the event, set the survey opening/closing times, choose **First answer only** or **First and final answers**, and add 1–20 agenda questions. Multiple-choice questions accept 2–8 distinct choices; short-text answers allow 1,000 characters.
4. Publish. Published questions, location mode and windows are immutable to protect saved responses. You may pause/reopen within the original window. Reopening does not extend the deadline.
5. Show the locally generated QR, copy the survey link, or let students access it from Events / Surveys. The QR encodes the current website's base path, including GitHub Pages project paths. It does not expire independently: submission access is controlled by the server-enforced survey window.

## Student flow and resume

- Scan the QR. Existing authenticated sessions resume the matching dashboard; otherwise log in first. The event link is retained through login.
- Only active, eligible student accounts can answer. Captured event rosters take precedence over current sections.
- Answer sequentially. Each submission uses a transaction and Firebase server timestamps; earlier answers cannot be rewritten, skipped or duplicated by retry.
- The first submission obtains fresh, precise browser location. Start-only reuses that evidence for the same attempt until the survey closes. Start-and-finish also checks the final answer. A single-question survey uses the same check for both endpoints.
- Close the website and return to **Surveys → Open / resume survey**, Events, or the same QR. Server-saved answers are restored, including on another device. Unsubmitted drafts are best-effort local browser storage scoped to student/event/question; clearing browser storage removes drafts, not submitted responses.
- Denied permission, stale GPS, accuracy worse than 50 m, or an outside-boundary result blocks the answer. Retry or request administrative review. No survey absence/fine is created.
- Location checks make at most two fresh one-shot requests (10-second then 5-second timeout) when a reading is coarse/stale or temporarily unavailable. The button shows retry progress. Permission denial, invalid coordinates and an accurate outside reading do not retry automatically. Poor-accuracy messages show the reported metres and unchanged 50 m limit. Leaving the view prevents another request or answer submission; no continuous watcher is used.
- Location exceptions require an authorized decision/reason and an immutable audit record. An approval applies only to the requested start/finish stage and does not override the answering window. Review requests can still be made after closure, but approval cannot reopen submission access.

## Data and permissions

- `events/{eventId}.hasSurvey` advertises survey availability.
- `eventSurveys/{eventId}` stores immutable questions/windows plus a pause flag.
- `eventSurveys/{eventId}/responses/{studentUid}` stores saved answers, counts, student ID/name snapshot, browser evidence, and latest review state.
- `.../responses/{studentUid}/reviews/{reviewId}` records immutable decisions, reasons, actor UID and server time.
- Student Managers do not receive survey administration or other students' response access.
- Location evidence stores method/result, boundary type, accuracy and check time—not raw GPS coordinates. No background location tracking is performed.
- Attendance and fines are never written by survey classes. No Cloud Functions, Firebase Storage or Blaze upgrade is used.
- Event listing is bounded to 100 recent events; a direct QR can load an older eligible event. Response browsing loads 25 records per page. Survey screens use explicit refresh instead of permanent Firestore subscriptions.

## Security limitations and deployment

This release uses **client-side location evidence**, not trusted GPS validation. Firestore rules enforce identity, role access, roster eligibility, server answering windows, question order, allowed answers, ownership and immutable review/response fields. A modified browser can forge location evidence. HTTPS and a polygon do not remove that limitation. Never use survey location alone as conclusive presence proof or an automatic penalty basis.

Authorized editors validate choice text in the app. Rules bound question schemas/counts and choice lists, while answer writes require non-empty string values belonging to the configured choices. This keeps rule expression costs bounded for 20 agendas.

Publish the updated **firestore.rules** before using surveys. Push/deploy the site assets, then hard-refresh all pages. Do not deploy `node_modules`, private keys or recovery tools to public hosting. QR generation uses the vendored `qrcode-generator` 2.0.4 library locally; URLs are not submitted to a QR service.

Real-phone GPS requires the published HTTPS website. A QR containing `localhost` refers to the scanning phone, not the development computer. Plain HTTP LAN addresses usually cannot provide browser location. GitHub Pages HTTPS is suitable for testing before Hostinger.

Automated Node tests use mocked Firebase transactions, not a live database. Firestore emulator authorization and real-phone visual/location testing remain required before production release; Java was unavailable in this workspace during implementation.

## Manual test checklist

1. Publish a two-question start-only survey as each allowed admin role; Student Manager must not see survey management.
2. Scan QR signed out, sign in, and confirm the correct event opens. Repeat while already signed in. Test on GitHub Pages paths and a Hostinger-style root domain.
3. Inside circle and polygon: submit first answer, then later answers without another GPS check in start-only mode.
4. Start-and-finish: first and final questions request fresh location, middle questions do not. Single-question surveys use one location check.
5. Close after a saved answer, reopen and resume. Test a second phone/account: only the signed-in student's own answers must appear. Local drafts must never be labeled submitted.
6. Try repeated clicks, a second tab, interrupted connection and retry: no answer overwrite or duplicate progress.
7. Reject outside, stale/poor-accuracy GPS and denied permission. Request review, approve/decline with reasons, refresh and resume. Check audit documents and stage-limited approvals.
8. Pause, refresh, then try submitting. Test server window boundaries, browser clock changes, and a closed-window approved review: rules must still reject invalid writes.
9. Inspect direct API attempts to skip agendas, change earlier answers, forge reviewer fields, read another student's response or write attendance/fines through survey code. Run these in the emulator too.
10. Test 20 questions, text/choice validation, light/navy theme, mobile navigation scrolling, keyboard focus, QR scanning, and more than 25 responses.
