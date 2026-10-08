-- MTshop migration 007: xavfsizlik (faol qurilmalar/sessiyalar va kirish tarixi)
-- Idempotent: qayta ishlasa ham xato bermaydi.
-- users jadvaliga ustunlar (pin_hash, frozen, ...) db.js dagi ensureColumn orqali qo'shiladi.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                       -- tasodifiy 32 belgi; JWT ichidagi "sid"
  user_id INTEGER NOT NULL REFERENCES users(id),
  device TEXT NOT NULL,                      -- masalan "Chrome · Windows"
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT                            -- NULL = faol
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ip TEXT,
  device TEXT NOT NULL,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 1,        -- 0 = noto'g'ri parol bilan urinish
  suspicious INTEGER NOT NULL DEFAULT 0,     -- 1 = yangi qurilmadan kirish
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, id);
