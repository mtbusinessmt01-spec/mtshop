-- MTshop migration 004: Gift Trade tizimi
-- Idempotent: qayta ishlasa ham xato bermaydi.
-- Vaqtlar hammasi ISO (toISOString) formatda saqlanadi — satr sifatida to'g'ri solishtiriladi.

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id),   -- request yuboruvchi
  user_b_id INTEGER NOT NULL REFERENCES users(id),   -- qabul qiluvchi
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','ACTIVE','REJECTED','CANCELLED','EXPIRED','COMPLETED','FAILED')),
  status_reason TEXT,                                -- masalan: superseded, cancelled_by_a, ...
  expires_at TEXT NOT NULL,                          -- request muddati (created_at + 5 daqiqa)
  a_coin INTEGER NOT NULL DEFAULT 0,                 -- A taklif qilgan coin (butun son)
  b_coin INTEGER NOT NULL DEFAULT 0,
  a_locked INTEGER NOT NULL DEFAULT 0,
  b_locked INTEGER NOT NULL DEFAULT 0,
  a_confirmed INTEGER NOT NULL DEFAULT 0,
  b_confirmed INTEGER NOT NULL DEFAULT 0,
  -- coin escrow: none (hali yo'q) / held (balansdan yechilib, trade'da turibdi) / released (qaytarilgan) / settled (almashgan)
  escrow TEXT NOT NULL DEFAULT 'none' CHECK(escrow IN ('none','held','released','settled')),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  rejected_at TEXT,
  expired_at TEXT,
  failed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_a ON trades(user_a_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_b ON trades(user_b_id, status);
-- Bitta foydalanuvchi bir vaqtda faqat bitta PENDING request YUBORA oladi (baza darajasida)
CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_one_pending_per_sender
  ON trades(user_a_id) WHERE status = 'PENDING';

-- Bir vaqtda faqat bitta ACTIVE trade: user_id PRIMARY KEY bo'lgani uchun
-- baza ikkinchi qator qo'shishga yo'l qo'ymaydi (eng muhim qoidaning baza darajasidagi kafolati)
CREATE TABLE IF NOT EXISTS trade_active_users (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  trade_id INTEGER NOT NULL REFERENCES trades(id)
);

-- Offerdagi giftlar (user_gifts.trade_id orqali band qilinadi)
CREATE TABLE IF NOT EXISTS trade_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES trades(id),
  user_id INTEGER NOT NULL REFERENCES users(id),     -- giftni taklif qilgan (egasi)
  user_gift_id INTEGER NOT NULL,
  gift_id INTEGER,
  gift_name TEXT,                                    -- tarix uchun nusxa
  created_at TEXT NOT NULL,
  UNIQUE(trade_id, user_gift_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_items_trade ON trade_items(trade_id);

CREATE TABLE IF NOT EXISTS trade_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES trades(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_messages_trade ON trade_messages(trade_id, id);

-- Audit log
CREATE TABLE IF NOT EXISTS trade_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_logs_trade ON trade_logs(trade_id, id);

-- Sayt ichidagi bildirishnomalar (push'dan tashqari; foydalanuvchi online bo'lganda ko'radi)
CREATE TABLE IF NOT EXISTS trade_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  trade_id INTEGER,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_notifications_user ON trade_notifications(user_id, seen);
