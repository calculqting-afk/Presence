
CREATE TABLE IF NOT EXISTS presence_authority (
  uid TEXT PRIMARY KEY,
  session_id TEXT,
  revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_presence (
  uid TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  online INTEGER NOT NULL CHECK (online IN (0, 1)),
  last_seen INTEGER NOT NULL
);
