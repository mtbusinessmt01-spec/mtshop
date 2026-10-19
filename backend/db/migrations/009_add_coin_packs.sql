-- Coin packlar (admin yaratadi) va MTbank orqali xaridlar
CREATE TABLE IF NOT EXISTS coin_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coins INTEGER NOT NULL CHECK (coins > 0),
  price_uzs INTEGER NOT NULL CHECK (price_uzs > 0),
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Har xarid pack'ning o'sha paytdagi coin va narxini saqlaydi (admin keyin narxni o'zgartirsa ham buzilmaydi)
CREATE TABLE IF NOT EXISTS coin_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pack_id INTEGER,
  order_id TEXT NOT NULL UNIQUE,
  coins INTEGER NOT NULL,
  price_uzs INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed
  bank_payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_coin_purchases_user ON coin_purchases(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_coin_purchases_bank ON coin_purchases(bank_payment_id);
