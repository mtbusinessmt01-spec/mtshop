-- MTshop migration 003
-- Sayt versiyalari: admin yangi versiyani draft -> beta -> public tartibida ochadi,
-- foydalanuvchi Profils'dan "yuklab olib" o'ziga yoqadi (users.app_version db.js'da qo'shiladi).
-- Idempotent: qayta ishlasa ham xato bermaydi.

CREATE TABLE IF NOT EXISTS app_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,            -- masalan "1.3"
  title TEXT NOT NULL DEFAULT '',
  changelog TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','beta','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Beta bosqichida versiya faqat shu ro'yxatdagi foydalanuvchilarga ochiladi
CREATE TABLE IF NOT EXISTS app_version_testers (
  version_id INTEGER NOT NULL REFERENCES app_versions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (version_id, user_id)
);
