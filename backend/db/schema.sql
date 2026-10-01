-- MTshop Database Schema

-- Foydalanuvchilar
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  coin_balance REAL NOT NULL DEFAULT 0,
  status_image_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Giftlar (admin yaratadi)
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT,
  price REAL NOT NULL,
  quantity INTEGER, -- NULL = cheksiz
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Foydalanuvchi egalik qilgan giftlar (inventar)
CREATE TABLE IF NOT EXISTS user_gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  gift_id INTEGER NOT NULL REFERENCES gifts(id),
  bought_price REAL NOT NULL, -- olingan paytdagi narx (tarix uchun)
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Case'lar (admin yaratadi)
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT,
  price REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Case ichidagi narsalar: gift yoki coin, har birining tushish shansi (%)
CREATE TABLE IF NOT EXISTS case_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('gift','coin')),
  gift_id INTEGER REFERENCES gifts(id), -- item_type='gift' bo'lsa
  coin_amount REAL, -- item_type='coin' bo'lsa
  chance_percent REAL NOT NULL
);

-- Foydalanuvchi egalik qilgan case'lar (hali ochilmagan)
CREATE TABLE IF NOT EXISTS user_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  case_id INTEGER NOT NULL REFERENCES cases(id),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pet turlari (admin yaratadi)
CREATE TABLE IF NOT EXISTS pet_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT,
  price REAL NOT NULL,
  coin_per_3h REAL NOT NULL,        -- har 3 soatda beradigan coin
  xp_to_feed_full REAL NOT NULL,    -- to'yish uchun kerakli XP
  xp_per_level REAL NOT NULL,       -- 1 LV oshishi uchun kerakli XP
  stock INTEGER,                     -- shopda nechta dona (NULL = cheksiz)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Foydalanuvchining pet'lari (max 2 tadan)
CREATE TABLE IF NOT EXISTS user_pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pet_type_id INTEGER NOT NULL REFERENCES pet_types(id),
  name TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  xp REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy','sick','dead')),
  last_fed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_income_at TEXT NOT NULL DEFAULT (datetime('now')),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kredit turlari (admin yaratadi)
CREATE TABLE IF NOT EXISTS credit_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_amount REAL NOT NULL,
  max_amount REAL NOT NULL,
  interest_percent REAL NOT NULL,
  installments_weeks INTEGER NOT NULL, -- necha haftaga bo'lib to'lanadi
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Foydalanuvchi olgan kreditlar
CREATE TABLE IF NOT EXISTS user_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  credit_type_id INTEGER NOT NULL REFERENCES credit_types(id),
  principal_amount REAL NOT NULL,       -- olingan asosiy summa
  total_to_pay REAL NOT NULL,           -- foiz bilan qaytariladigan summa
  remaining_amount REAL NOT NULL,       -- qolgan qarz
  weekly_payment REAL NOT NULL,
  fine_count INTEGER NOT NULL DEFAULT 0,
  next_payment_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paid','defaulted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kredit to'lovlari tarixi
CREATE TABLE IF NOT EXISTS credit_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_credit_id INTEGER NOT NULL REFERENCES user_credits(id),
  amount REAL NOT NULL,
  payment_type TEXT NOT NULL CHECK(payment_type IN ('scheduled','early')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Transferlar (gift/coin/case) — 3% komissiya coin transferida
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL CHECK(item_type IN ('gift','coin','case')),
  coin_amount REAL,          -- item_type='coin' bo'lsa (yuboruvchidan yechilgan, komissiya bilan)
  commission REAL DEFAULT 0,
  gift_id INTEGER REFERENCES gifts(id),
  case_id INTEGER REFERENCES cases(id),
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Web Push bildirishnomalar ----------

-- Umumiy sozlamalar (masalan VAPID kalitlari) — bazada saqlanadi, shuning uchun qayta deploy qilinsa ham yo'qolmaydi
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Foydalanuvchi qurilmalarining push obunalari (bitta foydalanuvchida bir nechta qurilma bo'lishi mumkin)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Avtomatik eslatmalar bir xil holat uchun qayta-qayta yuborilmasligi uchun jurnal
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, ref_id, marker)
);

-- Admin push'ga qo'shgan rasmlar (push xabarda rasm URL sifatida beriladi, shuning uchun bazada saqlanib alohida manzildan tarqatiladi)
CREATE TABLE IF NOT EXISTS push_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Eventlar (admin yaratadi)
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

-- Kafillik orqali kredit olish so'rovlari
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

-- Kafil javobgarligi: qarzdor to'lamasa kafilga 2 sutka beriladi, keyin kafildan to'lovning 50% olinadi
CREATE TABLE IF NOT EXISTS guarantor_overdues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_credit_id INTEGER NOT NULL REFERENCES user_credits(id),
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  guarantor_id INTEGER NOT NULL REFERENCES users(id),
  week_payment REAL NOT NULL,        -- kechikkan haftalik to'lov summasi
  penalty_amount REAL NOT NULL,      -- kafildan olinadigan summa (week_payment ning 50%)
  due_at TEXT NOT NULL,              -- to'lov muddati (ISO)
  deadline_at TEXT NOT NULL,         -- kafil uchun muddat: aniqlangan paytdan 2 sutka (ISO)
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','paid','charged','void')),
  reminded_at TEXT,                  -- kafil qarzdorga oxirgi marta eslatgan vaqt
  borrower_seen INTEGER NOT NULL DEFAULT 1, -- qarzdor kafil eslatmasini ko'rganmi (eslatilganda 0 bo'ladi)
  charged_amount REAL,               -- kafildan haqiqatda yechilgan summa
  guarantor_seen INTEGER NOT NULL DEFAULT 0, -- kafil "yechildi" xabarini ko'rganmi
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_credit_id, due_at)
);

CREATE INDEX IF NOT EXISTS idx_guarantor_overdues_guarantor_status
  ON guarantor_overdues(guarantor_id, status);

CREATE INDEX IF NOT EXISTS idx_guarantor_overdues_borrower_status
  ON guarantor_overdues(borrower_id, status);
