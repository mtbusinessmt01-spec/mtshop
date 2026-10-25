-- MTshop migration 013
-- Daily Case: foydalanuvchi har 24 soatda bir marta bepul ochadigan case.
-- cases.is_daily ustuni db.js dagi ensureColumn orqali qo'shiladi.

-- Har foydalanuvchi uchun BITTA qator: oxirgi ochilgan vaqt (PRIMARY KEY — ikki marta ochishdan baza darajasida himoya)
CREATE TABLE IF NOT EXISTS daily_case_claims (
  user_id INTEGER PRIMARY KEY,
  last_opened_at TEXT NOT NULL
);

-- Ochilishlar jurnali (admin statistikasi uchun)
CREATE TABLE IF NOT EXISTS daily_case_opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  opened_at TEXT NOT NULL,
  item_type TEXT NOT NULL,          -- 'coin' | 'gift'
  coin_amount REAL,
  gift_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_daily_case_opens_time ON daily_case_opens(opened_at);
