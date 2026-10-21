-- Gift turlari: bitta giftning nomi, narxi va rasmi bilan farq qiluvchi turlari
CREATE TABLE IF NOT EXISTS gift_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_id INTEGER NOT NULL REFERENCES gifts(id),
  name TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gift_variants_gift ON gift_variants(gift_id);

-- Foydalanuvchi sotib olgan giftning qaysi turi ekani (NULL = asosiy gift)
ALTER TABLE user_gifts ADD COLUMN variant_id INTEGER;

-- Admin o'zgartira oladigan umumiy sozlamalar
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Coin yuborish komissiyasi (foizda). Admin bayramlarda o'zgartira oladi.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('transfer_commission_percent', '5');
