-- Gradual migration: shared read models; transactional source writes stay intact.
CREATE TABLE feature_reads (
  cache_key TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT NOT NULL DEFAULT ''
);
CREATE INDEX feature_reads_group ON feature_reads(group_key);
CREATE INDEX feature_reads_expiry ON feature_reads(expires_at);
