-- MTshop migration 015
-- Premium: sotib olish va admin amallari tarixi (users.premium_until ustuni db.js ichida ensureColumn bilan qo'shiladi)
CREATE TABLE IF NOT EXISTS premium_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- purchase | admin_grant | admin_revoke
  days INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  until_after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_premium_log_user ON premium_log(user_id, id DESC);
