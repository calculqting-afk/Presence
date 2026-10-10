# Presence project conventions

## Object-oriented feature structure

The user requires all future feature updates to follow a clear object-oriented structure.

- Put feature behavior in focused controller/service classes with a single responsibility.
- Keep state on the owning instance and use clearly named methods for user actions, persistence and rendering.
- Use constructor dependencies when practical so behavior can be tested without live Firebase or a browser.
- Make initialization idempotent and provide cleanup for listeners/subscriptions owned by a controller.
- Keep entry scripts limited to constructing and initializing controllers; avoid adding large procedural feature handlers to them.
- Prefer composition over unnecessary inheritance. Small pure helpers can support classes; HTML, CSS, tests and Firestore rules remain in their native declarative/test formats.
- Preserve existing behavior during structural refactors and add regression tests. Do not rewrite unrelated legacy code simply to introduce classes.

The login `ThemeController` is loaded as a classic script before CSS to restore the saved theme before first paint. Preserve that behavior and its independence from Firebase initialization.
