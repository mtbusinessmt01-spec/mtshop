-- AirDrop: yaqin foydalanuvchiga gift tashlash (qabul qilinganda gift ko'chadi)
CREATE TABLE IF NOT EXISTS airdrops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  user_gift_id INTEGER NOT NULL,
  gift_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING, ACCEPTED, DECLINED, CANCELLED, EXPIRED, FAILED
  distance_m REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_airdrops_to ON airdrops(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_airdrops_from ON airdrops(from_user_id, status);
-- Bitta yuboruvchida bir vaqtda faqat 1 ta kutilayotgan airdrop (baza darajasida)
CREATE UNIQUE INDEX IF NOT EXISTS uq_airdrops_one_pending_per_sender ON airdrops(from_user_id) WHERE status = 'PENDING';
