# Three-step student registration

The existing registration modal now shows three connected circles:

1. **Personal details:** Student ID, birthday, first name, last name.
2. **School details:** Course and section.
3. **Account security:** Password, confirmation, and a read-only summary of the preceding details. Passwords never appear in the summary.

Next validates only the active step. Validated circles become checkmarks and connecting lines fill. Back retains entered values in memory. Enter on the first two steps acts as Next, not a submission. Final submission revalidates every step and reveals/focuses any invalid field, including earlier fields changed by autofill. Birthday cannot be in the future; password minimum remains 8 characters.

Only the final Send registration request action calls the existing Firebase Auth/Firestore registration flow. While pending, repeat submissions, Back/Next and close controls are blocked. The third circle completes only after the save succeeds. Success still means awaiting admin approval, not an active approved account. Save failures retain the form for retry; existing declined-account resubmission remains supported.

Cancel/close/disposal clear password inputs. Reopening returns to Step 1. No registration draft is written to browser storage by this feature. Tab/Shift+Tab wrap within the registration modal; Escape closes it unless a save is pending. Hidden steps stay outside keyboard navigation, and a live status announces the current step. Animations respect Reduce Motion.

No Firestore schema, permissions, rules deployment, GitHub push, or APK release is needed merely to implement this frontend change. Rebuild the APK when distributing the updated interface.

## Local verification

Run `npm.cmd test` and `npm.cmd run check`. Open the local login page and hard-refresh. Test empty Next, invalid/future birthday, school selections, password mismatch, Back, Enter, review text, cancellation/reopening, keyboard focus, light/dark mode, small screens and Reduce Motion. Use a test Student ID for the final action because it creates a real account/request when connected to live Firebase. Test actual request save, administrator approval and declined-request resubmission separately from UI-only navigation.
