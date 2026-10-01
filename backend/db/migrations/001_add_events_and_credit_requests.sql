-- MTshop migration 001
-- Eventlar va kafil orqali kredit so'rovlari.
-- Barcha CREATE/INDEX buyruqlari idempotent: migration qayta ishlasa ham xato bermaydi.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  banner_url TEXT,
  wallpaper_url TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_dates ON events(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS credit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  guarantor_id INTEGER NOT NULL REFERENCES users(id),
  credit_type_id INTEGER NOT NULL REFERENCES credit_types(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_requests_guarantor_status
  ON credit_requests(guarantor_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_credit_requests_user_status
  ON credit_requests(user_id, status, created_at);
