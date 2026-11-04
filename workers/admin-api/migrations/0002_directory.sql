CREATE TABLE IF NOT EXISTS student_directory (
  uid TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision TEXT NOT NULL,
  touched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS directory_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at INTEGER NOT NULL DEFAULT 0,
  full_at INTEGER NOT NULL DEFAULT 0,
  watermark TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT
);
INSERT OR IGNORE INTO directory_sync (id) VALUES (1);
