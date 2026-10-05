-- MTshop migration 006: promokodlar
-- Idempotent: qayta ishlasa ham xato bermaydi.

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- har doim KATTA harfda saqlanadi
  coin_amount REAL NOT NULL DEFAULT 0,       -- 0 = coin berilmaydi
  max_uses INTEGER,                          -- NULL = cheksiz (nechta kishi ishlata oladi)
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                           -- NULL = muddatsiz (UTC, ISO)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Promokod ichidagi gift / case lar
CREATE TABLE IF NOT EXISTS promo_code_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL REFERENCES promo_codes(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('gift','case')),
  gift_id INTEGER,
  case_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_promo_items_promo ON promo_code_items(promo_id);

-- Kim qachon ishlatgani (bitta foydalanuvchi bitta kodni faqat 1 marta)
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL REFERENCES promo_codes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(promo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_red_promo ON promo_redemptions(promo_id);
