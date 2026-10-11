# Dashboard object-oriented structure

The refactor preserves the UI, Firebase schemas, role permissions and attendance/survey policies. It does not change the theme bootstrap or its storage key.

## Ownership

- `DashboardApplication` owns authenticated startup, the role dashboard, the survey controller and shutdown. Parallel initialization requests share one promise; late module loading cannot restart a disposed application.
- `DashboardSessionService` owns the authentication subscription, user, role and profile verification. Late profile reads are ignored after disposal.
- `DashboardNavigationController` owns view navigation, history and the logout modal/action.
- `NotificationCenterController` owns notification records, filters, subscription, retries and panel listeners.
- `NotificationService` owns notification creation and recipient/category policy.
- `FaceRegistrationService` owns authenticated Drive requests and registration acknowledgement polling.
- `DashboardToastController`, `DashboardGreetingController` and `FineModalController` own their respective presentation behavior.
- `AdminDashboard` and `StudentDashboard` are role-level coordinators. Their initialization methods call named setup/wiring methods; state is stored on the instance, and user actions/rendering/persistence use named, bound methods. Existing focused attendance, survey, geofence and permission components are composed rather than rewritten.
- `ControllerScope` composes listener, mounted-element and cleanup ownership. Initializing twice does not register twice; cleanup runs in reverse order and still completes other callbacks if one throws.

## Compatibility boundary

`dashboard.js` still exports the existing names used by controllers. Stateful function exports are thin adapters to the owning instances; session/navigation exports mirror their class-owned state for existing consumers. Pure formatting, escaping and record-to-markup helpers remain ordinary functions intentionally.

Every import of `dashboard.js` must resolve to exactly the same URL, including its version query. The regression test checks this across the JavaScript tree to avoid a second bootstrap instance.

## Verification after deployment

1. Hard-refresh both dashboard pages. Navigate to Surveys repeatedly and confirm there is one panel.
2. Test authorized navigation for Super Admin, Head Admin, Attendance Manager and Student Manager.
3. On a test event, check in/out, review attendance and resume a survey.
4. Test directory search, role-allowed student actions, event editing and fine views using disposable test records.
5. Open/close notifications, profile and logout modals. Confirm Cancel works and loading buttons recover on errors.
6. Log out and back in; ensure no duplicated events, notifications or listeners.

Automated tests use mocked SDKs and browser surfaces. They do not substitute for a live Firebase/browser smoke test and do not delete live data.
