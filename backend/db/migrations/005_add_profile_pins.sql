-- MTshop migration 005: profilga qadalgan giftlar (📌)
-- Emoji status uchun users.emoji_gift_id ustuni db.js ichida (ensureColumn) qo'shiladi.
-- Idempotent: qayta ishlasa ham xato bermaydi.

CREATE TABLE IF NOT EXISTS profile_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_gift_id INTEGER NOT NULL UNIQUE,      -- aynan shu gift nusxasi (bitta nusxa faqat bir marta qadaladi)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_pins_user ON profile_pins(user_id, position);
