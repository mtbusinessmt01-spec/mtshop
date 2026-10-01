-- MTshop migration 002
-- Kafil javobgarligi: qarzdor to'lamasa kafilga 2 sutka beriladi, keyin kafildan to'lovning 50% olinadi.
-- Idempotent: qayta ishlasa ham xato bermaydi.

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
