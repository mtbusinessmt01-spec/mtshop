-- MTshop migration 014
-- Bildirishnomalar markazi (inbox), kategoriyalar bo'yicha sozlamalar va tinch rejim.

-- Har foydalanuvchining bildirishnomalari (30 kun / eng ko'pi 100 ta saqlanadi)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,              -- pet | gifts | credit | news | security
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '/index.html',
  tag TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Kategoriya bo'yicha push yoqilgan/o'chirilgan (qator yo'q = yoqilgan)
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, category)
);

-- Tinch rejim: vaqtlar kunning boshidan daqiqalarda (1380 = 23:00, 420 = 07:00); tz_offset — UTC'dan daqiqalarda (300 = UTC+5)
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id INTEGER PRIMARY KEY,
  quiet_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_start INTEGER NOT NULL DEFAULT 1380,
  quiet_end INTEGER NOT NULL DEFAULT 420,
  tz_offset INTEGER NOT NULL DEFAULT 300
);
