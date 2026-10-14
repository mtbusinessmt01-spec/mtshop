-- MTshop migration 008: pullik profil kartasi uslublari
-- users.card_style_id ustuni db.js ichida (ensureColumn) qo'shiladi.
-- Idempotent: qayta ishlasa ham xato bermaydi.

CREATE TABLE IF NOT EXISTS card_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gradient',      -- 'solid' | 'gradient' | 'glow'
  color1 TEXT NOT NULL,
  color2 TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_card_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  style_id INTEGER NOT NULL REFERENCES card_styles(id),
  paid REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, style_id)
);
CREATE INDEX IF NOT EXISTS idx_user_card_styles_user ON user_card_styles(user_id);
