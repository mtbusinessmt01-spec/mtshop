// Biometrik qulf (WebAuthn / passkey): Face ID, Touch ID, Windows Hello, Android barmoq izi.
// Qanday ishlaydi:
//  1) Yoqishda qurilma kalit juftligi yaratadi; serverga faqat OCHIQ kalit beriladi.
//  2) PIN so'ralganda qurilma biometrik tekshiruvdan so'ng challenge'ni imzolaydi.
//  3) Server imzoni tekshiradi va qisqa muddatli, BIR MARTALIK token beradi ("bio:<token>"),
//     u X-Tx-Pin sarlavhasida PIN o'rniga yuboriladi (security.requirePin qabul qiladi).
// Tashqi kutubxona kerak emas (Node crypto yetarli).
const crypto = require('crypto');
const db = require('./db');

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const TOKEN_TTL_MS = 2 * 60 * 1000;
const MAX_CREDENTIALS = 5;
const MAX_FAILS = 10, FAIL_WINDOW_MS = 15 * 60 * 1000;

class BioError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

const challenges = new Map();   // `${userId}:${purpose}` -> { challenge, until }
const tokens = new Map();       // token -> { userId, until }
const fails = new Map();        // userId -> { n, since }

function rp(req) {
  return { rpId: req.hostname, origin: `${req.protocol}://${req.get('host')}` };
}

function newChallenge(userId, purpose) {
  const c = b64u(crypto.randomBytes(32));
  challenges.set(`${userId}:${purpose}`, { challenge: c, until: Date.now() + CHALLENGE_TTL_MS });
  return c;
}
function takeChallenge(userId, purpose) {
  const k = `${userId}:${purpose}`, v = challenges.get(k);
  challenges.delete(k);                                   // har challenge bir marta ishlatiladi
  return v && v.until > Date.now() ? v.challenge : null;
}

function checkClientData(clientDataJSON, type, expectedChallenge, origin) {
  let cd;
  try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch (e) { throw new BioError(400, "Biometrik javob noto'g'ri"); }
  if (cd.type !== type) throw new BioError(400, "Biometrik javob turi noto'g'ri");
  if (!expectedChallenge || cd.challenge !== expectedChallenge) throw new BioError(403, 'Biometrik so\'rov muddati tugagan, qayta urinib ko\'ring', { bio_expired: true });
  if (cd.origin !== origin) throw new BioError(403, 'Sayt manzili mos kelmadi');
}

// ---- Sof (DB'siz) imzo tekshiruvi: sinash oson ----
function verifySignature(pubKeySpkiDer, alg, data, sig) {
  const key = crypto.createPublicKey({ key: pubKeySpkiDer, format: 'der', type: 'spki' });
  if (alg === -7) return key.asymmetricKeyType === 'ec' && crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
  if (alg === -257) return key.asymmetricKeyType === 'rsa' && crypto.verify('sha256', data, key, sig);
  return false;
}

function verifyAssertion({ pubKey, alg, clientDataJSON, authenticatorData, signature, rpId }) {
  if (authenticatorData.length < 37) return { ok: false };
  if (!authenticatorData.subarray(0, 32).equals(sha256(Buffer.from(rpId)))) return { ok: false };
  const flags = authenticatorData[32];
  if (!(flags & 0x01) || !(flags & 0x04)) return { ok: false };   // foydalanuvchi mavjud (UP) va biometrik/PIN bilan tasdiqlangan (UV) bo'lishi shart
  const signCount = authenticatorData.readUInt32BE(33);
  const data = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  let ok = false;
  try { ok = verifySignature(pubKey, alg, data, signature); } catch (e) { ok = false; }
  return { ok, signCount };
}

function failed(userId) {
  const now = Date.now(), f = fails.get(userId);
  if (!f || now - f.since > FAIL_WINDOW_MS) fails.set(userId, { n: 1, since: now }); else f.n += 1;
}
function assertNotLocked(userId) {
  const f = fails.get(userId);
  if (f && Date.now() - f.since <= FAIL_WINDOW_MS && f.n >= MAX_FAILS) {
    throw new BioError(429, "Biometrik urinishlar ko'p. Birozdan keyin yoki PIN bilan urinib ko'ring");
  }
}

async function listFor(userId) {
  return db.prepare('SELECT id, public_key, alg, sign_count, label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at').all(userId);
}
async function count(userId) {
  const r = await db.prepare('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE user_id = ?').get(userId);
  return r ? r.c : 0;
}
async function publicList(userId) {
  return (await listFor(userId)).map(c => ({ id: c.id, label: c.label, created_at: c.created_at, last_used_at: c.last_used_at }));
}

// ---------- Yoqish (ro'yxatdan o'tkazish) ----------
async function registerOptions(userId, req) {
  const existing = await listFor(userId);
  if (existing.length >= MAX_CREDENTIALS) throw new BioError(400, `Eng ko'pi bilan ${MAX_CREDENTIALS} ta qurilmada yoqish mumkin`);
  const u = await db.prepare('SELECT username, full_name FROM users WHERE id = ?').get(userId);
  if (!u) throw new BioError(404, 'Foydalanuvchi topilmadi');
  return {
    challenge: newChallenge(userId, 'create'),
    rp: { name: 'MTshop', id: rp(req).rpId },
    user: { id: b64u(Buffer.from('mt' + userId)), name: u.username, displayName: u.full_name || u.username },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    excludeCredentials: existing.map(c => ({ type: 'public-key', id: c.id })),
    attestation: 'none',
    timeout: 60000,
  };
}

async function registerFinish(userId, req, body) {
  const { id, clientDataJSON, publicKey, alg, label } = body || {};
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,1024}$/.test(id)) throw new BioError(400, "Kalit identifikatori noto'g'ri");
  const a = Number(alg);
  if (a !== -7 && a !== -257) throw new BioError(400, "Qurilma kalit turi qo'llab-quvvatlanmaydi");
  checkClientData(fromB64u(clientDataJSON), 'webauthn.create', takeChallenge(userId, 'create'), rp(req).origin);
  const der = fromB64u(publicKey);
  try {
    const k = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if ((a === -7) !== (k.asymmetricKeyType === 'ec')) throw new Error('mos emas');
  } catch (e) { throw new BioError(400, "Ochiq kalit noto'g'ri"); }
  if (await count(userId) >= MAX_CREDENTIALS) throw new BioError(400, `Eng ko'pi bilan ${MAX_CREDENTIALS} ta qurilmada yoqish mumkin`);
  const taken = await db.prepare('SELECT user_id FROM webauthn_credentials WHERE id = ?').get(id);
  if (taken) throw new BioError(409, 'Bu kalit allaqachon ro\'yxatdan o\'tgan');
  await db.prepare('INSERT INTO webauthn_credentials (id, user_id, public_key, alg, label) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, der.toString('base64'), a, String(label || '').slice(0, 80) || null);
  return { ok: true, id };
}

// ---------- PIN o'rnida ishlatish ----------
async function authOptions(userId, req) {
  assertNotLocked(userId);
  const creds = await listFor(userId);
  if (!creds.length) throw new BioError(404, 'Biometrik qulf yoqilmagan', { bio_none: true });
  return {
    challenge: newChallenge(userId, 'get'),
    rpId: rp(req).rpId,
    allowCredentials: creds.map(c => ({ type: 'public-key', id: c.id })),
    userVerification: 'required',
    timeout: 60000,
  };
}

async function authVerify(userId, req, body) {
  assertNotLocked(userId);
  const { id, clientDataJSON, authenticatorData, signature } = body || {};
  const cred = await db.prepare('SELECT id, public_key, alg, sign_count FROM webauthn_credentials WHERE id = ? AND user_id = ?').get(String(id || ''), userId);
  if (!cred) { failed(userId); throw new BioError(403, 'Bu qurilmada biometrik qulf yoqilmagan', { bio_none: true }); }
  const { rpId, origin } = rp(req);
  const cdj = fromB64u(clientDataJSON);
  try { checkClientData(cdj, 'webauthn.get', takeChallenge(userId, 'get'), origin); }
  catch (e) { if (e instanceof BioError && !e.extra.bio_expired) failed(userId); throw e; }
  const r = verifyAssertion({
    pubKey: Buffer.from(cred.public_key, 'base64'), alg: cred.alg, clientDataJSON: cdj,
    authenticatorData: fromB64u(authenticatorData), signature: fromB64u(signature), rpId,
  });
  if (!r.ok) { failed(userId); throw new BioError(403, 'Biometrik tasdiq o\'tmadi'); }
  if (r.signCount > 0 && cred.sign_count > 0 && r.signCount <= cred.sign_count) {   // klonlangan kalit belgisi
    failed(userId); throw new BioError(403, 'Biometrik kalit shubhali — PIN kiriting');
  }
  await db.prepare("UPDATE webauthn_credentials SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?").run(r.signCount, cred.id);
  fails.delete(userId);
  if (tokens.size > 5000) tokens.clear();
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { userId, until: Date.now() + TOKEN_TTL_MS });
  return { token, expires_in: TOKEN_TTL_MS / 1000 };
}

// security.requirePin ishlatadi: token faqat bir marta va faqat egasi uchun amal qiladi
function consumeToken(userId, token) {
  const t = tokens.get(String(token || ''));
  tokens.delete(String(token || ''));
  return !!(t && t.userId === userId && t.until > Date.now());
}

async function remove(userId, id) {
  if (id) await db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(String(id), userId);
  else await db.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(userId);
  for (const [t, v] of tokens) if (v.userId === userId && !id) tokens.delete(t);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.until < now) challenges.delete(k);
  for (const [k, v] of tokens) if (v.until < now) tokens.delete(k);
  for (const [k, v] of fails) if (now - v.since > FAIL_WINDOW_MS) fails.delete(k);
}, 60 * 1000).unref();

module.exports = {
  BioError, registerOptions, registerFinish, authOptions, authVerify, consumeToken, remove, count, publicList,
  _verifyAssertion: verifyAssertion,
};
