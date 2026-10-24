-- Biometrik qulf (Face ID / Touch ID / Windows Hello): WebAuthn kalitlari.
-- Faqat OCHIQ kalit saqlanadi — barmoq izi/yuz qurilmadan chiqmaydi.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,                 -- credential id (base64url)
  user_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,            -- SPKI DER (base64)
  alg INTEGER NOT NULL,                -- -7 (ES256) yoki -257 (RS256)
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
