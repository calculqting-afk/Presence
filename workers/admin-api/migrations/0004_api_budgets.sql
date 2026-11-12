-- Server-only request counters. UID and budget names come from verified claims/routes.
CREATE TABLE IF NOT EXISTS api_budgets (
  uid TEXT NOT NULL,
  budget TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (uid, budget)
);
CREATE INDEX IF NOT EXISTS api_budgets_expiry ON api_budgets(expires_at);
