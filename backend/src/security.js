// Xavfsizlik: faol qurilmalar (sessiyalar), kirish tarixi, tranzaksiya PIN, hisobni muzlatish.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const push = require('./push');
const { parseDevice } = require('./device');

const PIN_MAX_ATTEMPTS = 5;                       // ketma-ket xato PIN
const PIN_LOCK_MS = 15 * 60 * 1000;               // shundan keyin 15 daqiqa bloklanadi
const PASSWORD_MAX_ATTEMPTS = 5;                  // PIN o'zgartirishda parol tekshiruvi
const PASSWORD_LOCK_MS = 15 * 60 * 1000;
const FAILED_LOGIN_ALERT_EVERY = 5;               // har 5-chi xato urinishda push
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_HISTORY_KEEP = 100;                   // har foydalanuvchi uchun oxirgi 100 ta yozuv
const SESSION_CACHE_MS = 15 * 1000;               // sessiya holati 15 soniya keshlanadi (har so'rovda DB'ga bormaslik uchun)
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

// SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) va ISO ikkalasini o'qiydi
function parseTs(str) {
  if (!str) return NaN;
  const s = String(str);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').getTime();
}
const toIso = (str) => (str ? new Date(parseTs(str)).toISOString() : null);

// ---------- Qurilma va IP ----------

function clientIp(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') || null;
}

function reqDevice(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '').slice(0, 300);
  return { ua, ...parseDevice(ua), ip: clientIp(req) };
}

// ---------- Sessiyalar ----------

const sessionCache = new Map();   // sid -> { result: 'ok'|'revoked'|'blocked', userId, until }

function purgeCache(userId, exceptSid) {
  for (const [sid, v] of sessionCache) {
    if (v.userId === userId && sid !== exceptSid) sessionCache.delete(sid);
  }
}

async function createSession(userId, req) {
  const id = crypto.randomBytes(16).toString('hex');
  const d = reqDevice(req);
  await db.prepare('INSERT INTO sessions (id, user_id, device, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, d.label, d.ip, d.ua);
  return id;
}

// 'ok' | 'revoked' | 'blocked'
async function checkSession(sid, userId) {
  const now = Date.now();
  const cached = sessionCache.get(sid);
  if (cached && cached.until > now && cached.userId === userId) return cached.result;

  const row = await db.prepare(`
    SELECT s.revoked_at, s.last_seen_at, u.is_blocked
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.user_id = ?
  `).get(sid, userId);

  const result = !row || row.revoked_at ? 'revoked' : (row.is_blocked ? 'blocked' : 'ok');
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(sid, { result, userId, until: now + SESSION_CACHE_MS });

  if (result === 'ok' && !(now - parseTs(row.last_seen_at) < LAST_SEEN_THROTTLE_MS)) {
    await db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(sid);
  }
  return result;
}

async function revokeSession(sid, userId) {
  const r = await db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(sid, userId);
  sessionCache.delete(sid);
  return r.changes;
}

// Boshqa barcha qurilmalardan chiqarish (joriy sessiya qoladi)
async function revokeOthers(userId, exceptSid) {
  const r = await db.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND (? IS NULL OR id != ?) AND revoked_at IS NULL"
  ).run(userId, exceptSid || null, exceptSid || null);
  // sid'i yo'q eski tokenlar ham bekor bo'lishi uchun
  await db.prepare('UPDATE users SET sessions_valid_after = ? WHERE id = ?').run(new Date().toISOString(), userId);
  purgeCache(userId, exceptSid);
  return r.changes;
}

async function listSessions(userId) {
  const rows = await db.prepare(
    'SELECT id, device, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC'
  ).all(userId);
  return rows.map(r => ({ id: r.id, device: r.device, ip: r.ip, created_at: toIso(r.created_at), last_seen_at: toIso(r.last_seen_at) }));
}

// ---------- Kirish tarixi va shubhali kirish ----------

async function pruneHistory(userId) {
  await db.prepare(`
    DELETE FROM login_history WHERE user_id = ? AND id NOT IN (
      SELECT id FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(userId, userId, LOGIN_HISTORY_KEEP);
}

// Muvaffaqiyatli kirish. Avval yozuvdan OLDIN "bu qurilma ilgari ko'rilganmi" tekshiriladi.
async function recordLogin(userId, req) {
  const d = reqDevice(req);
  const hadAny = await db.prepare('SELECT 1 AS x FROM login_history WHERE user_id = ? AND success = 1 LIMIT 1').get(userId);
  const seen = await db.prepare('SELECT 1 AS x FROM login_history WHERE user_id = ? AND success = 1 AND device = ? LIMIT 1').get(userId, d.label);
  const suspicious = hadAny && !seen ? 1 : 0;   // birinchi kirish shubhali emas

  await db.prepare('INSERT INTO login_history (user_id, ip, device, user_agent, success, suspicious) VALUES (?, ?, ?, ?, 1, ?)')
    .run(userId, d.ip, d.label, d.ua, suspicious);
  await pruneHistory(userId);

  if (suspicious) {
    push.notifyUser(userId, {
      title: '🔐 Yangi qurilmadan kirildi',
      body: `${d.label}${d.ip ? ' (IP: ' + d.ip + ')' : ''}. Bu siz bo'lmasangiz, Profils > Xavfsizlik bo'limida boshqa qurilmalardan chiqing.`,
      url: '/index.html',
      tag: 'security-login',
    });
  }
  return { suspicious: !!suspicious };
}

// Noto'g'ri parol bilan urinish. Qisqa vaqtda ko'p bo'lsa push yuboriladi.
async function recordFailedLogin(userId, req) {
  const d = reqDevice(req);
  await db.prepare('INSERT INTO login_history (user_id, ip, device, user_agent, success, suspicious) VALUES (?, ?, ?, ?, 0, 0)')
    .run(userId, d.ip, d.label, d.ua);
  await pruneHistory(userId);

  const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MS).toISOString().slice(0, 19).replace('T', ' ');
  const row = await db.prepare('SELECT COUNT(*) AS c FROM login_history WHERE user_id = ? AND success = 0 AND created_at >= ?').get(userId, since);
  if (row.c > 0 && row.c % FAILED_LOGIN_ALERT_EVERY === 0) {
    push.notifyUser(userId, {
      title: '⚠️ Hisobingizga kirishga urinishlar',
      body: `So'nggi 15 daqiqada ${row.c} marta noto'g'ri parol kiritildi (${d.label}${d.ip ? ', IP: ' + d.ip : ''}).`,
      url: '/index.html',
      tag: 'security-failed-login',
    });
  }
  return row.c;
}

async function listLogins(userId, limit = 50) {
  const rows = await db.prepare(
    'SELECT id, ip, device, success, suspicious, created_at FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
  return rows.map(r => ({ id: r.id, ip: r.ip, device: r.device, success: !!r.success, suspicious: !!r.suspicious, created_at: toIso(r.created_at) }));
}

// ---------- Parol tekshiruvi (PIN o'zgartirish uchun), urinishlar cheklangan ----------

const pwAttempts = new Map();   // userId -> { fails, lockedUntil }

async function checkPassword(userId, password) {
  const st = pwAttempts.get(userId) || { fails: 0, lockedUntil: 0 };
  const now = Date.now();
  if (st.lockedUntil > now) {
    return { ok: false, locked: true, retryAfterSec: Math.ceil((st.lockedUntil - now) / 1000) };
  }
  const u = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (u && password && bcrypt.compareSync(String(password), u.password_hash)) {
    pwAttempts.delete(userId);
    return { ok: true };
  }
  st.fails += 1;
  if (st.fails >= PASSWORD_MAX_ATTEMPTS) {
    st.fails = 0; st.lockedUntil = now + PASSWORD_LOCK_MS;
    pwAttempts.set(userId, st);
    return { ok: false, locked: true, retryAfterSec: Math.ceil(PASSWORD_LOCK_MS / 1000) };
  }
  pwAttempts.set(userId, st);
  return { ok: false, locked: false, attemptsLeft: PASSWORD_MAX_ATTEMPTS - st.fails };
}

// ---------- Tranzaksiya PIN ----------

const isValidPin = (pin) => /^\d{4,6}$/.test(String(pin == null ? '' : pin));

async function setPin(userId, pin) {
  const hash = bcrypt.hashSync(String(pin), 10);
  await db.prepare('UPDATE users SET pin_hash = ?, pin_failed = 0, pin_locked_until = NULL WHERE id = ?').run(hash, userId);
}

async function clearPin(userId) {
  await db.prepare('UPDATE users SET pin_hash = NULL, pin_failed = 0, pin_locked_until = NULL WHERE id = ?').run(userId);
}

// Middleware: foydalanuvchida PIN o'rnatilgan bo'lsa, "X-Tx-Pin" sarlavhasi to'g'ri bo'lishi shart.
async function requirePin(req, res, next) {
  try {
    const u = await db.prepare('SELECT pin_hash, pin_failed, pin_locked_until FROM users WHERE id = ?').get(req.user.id);
    if (!u) return res.status(401).json({ error: 'Tizimga kirmagansiz' });
    if (!u.pin_hash) return next();

    const now = Date.now();
    const lockedMs = u.pin_locked_until ? parseTs(u.pin_locked_until) - now : 0;
    if (lockedMs > 0) {
      return res.status(429).json({
        error: `PIN ko'p marta xato kiritildi. ${Math.ceil(lockedMs / 60000)} daqiqadan keyin urinib ko'ring`,
        pin_locked: true, retry_after_sec: Math.ceil(lockedMs / 1000),
      });
    }

    const pin = String(req.headers['x-tx-pin'] || '');
    if (!pin) return res.status(403).json({ error: 'Tranzaksiya PIN kodi kerak', pin_required: true });

    if (!isValidPin(pin) || !bcrypt.compareSync(pin, u.pin_hash)) {
      const failed = (u.pin_failed || 0) + 1;
      if (failed >= PIN_MAX_ATTEMPTS) {
        await db.prepare('UPDATE users SET pin_failed = 0, pin_locked_until = ? WHERE id = ?')
          .run(new Date(now + PIN_LOCK_MS).toISOString(), req.user.id);
        push.notifyUser(req.user.id, {
          title: '⚠️ PIN ko\'p marta xato kiritildi',
          body: "Hisobingizda PIN 5 marta noto'g'ri kiritildi, 15 daqiqaga bloklandi. Bu siz bo'lmasangiz, boshqa qurilmalardan chiqing.",
          url: '/index.html', tag: 'security-pin-locked',
        });
        return res.status(429).json({
          error: "PIN ko'p marta xato kiritildi. 15 daqiqadan keyin urinib ko'ring",
          pin_locked: true, retry_after_sec: Math.ceil(PIN_LOCK_MS / 1000),
        });
      }
      await db.prepare('UPDATE users SET pin_failed = ? WHERE id = ?').run(failed, req.user.id);
      return res.status(403).json({
        error: `PIN noto'g'ri. ${PIN_MAX_ATTEMPTS - failed} ta urinish qoldi`,
        pin_required: true, pin_invalid: true, attempts_left: PIN_MAX_ATTEMPTS - failed,
      });
    }

    if (u.pin_failed) await db.prepare('UPDATE users SET pin_failed = 0 WHERE id = ?').run(req.user.id);
    next();
  } catch (e) {
    console.error('PIN tekshiruvi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

// ---------- Hisobni muzlatish (transfer va trade o'chiriladi) ----------

function isFrozenRow(u) {
  if (!u || !u.frozen) return false;
  if (!u.frozen_until) return true;                 // muddatsiz — foydalanuvchi o'zi yoqmaguncha
  return parseTs(u.frozen_until) > Date.now();
}

const FROZEN_MSG = "Hisobingiz muzlatilgan: transfer va trade vaqtincha o'chirilgan. Profils > Xavfsizlik bo'limidan yoqishingiz mumkin.";

async function requireNotFrozen(req, res, next) {
  try {
    const u = await db.prepare('SELECT frozen, frozen_until FROM users WHERE id = ?').get(req.user.id);
    if (isFrozenRow(u)) {
      return res.status(403).json({ error: FROZEN_MSG, account_frozen: true, frozen_until: toIso(u.frozen_until) });
    }
    next();
  } catch (e) {
    console.error('Muzlatish tekshiruvi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

async function freeze(userId, hours) {
  const until = hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;
  await db.prepare('UPDATE users SET frozen = 1, frozen_until = ? WHERE id = ?').run(until, userId);
  return until;
}

async function unfreeze(userId) {
  await db.prepare('UPDATE users SET frozen = 0, frozen_until = NULL WHERE id = ?').run(userId);
}

async function status(userId) {
  const u = await db.prepare('SELECT pin_hash, pin_locked_until, frozen, frozen_until FROM users WHERE id = ?').get(userId);
  const lockedMs = u && u.pin_locked_until ? parseTs(u.pin_locked_until) - Date.now() : 0;
  const frozen = isFrozenRow(u);
  return {
    has_pin: !!(u && u.pin_hash),
    pin_locked_until: lockedMs > 0 ? toIso(u.pin_locked_until) : null,
    frozen,
    frozen_until: frozen ? toIso(u.frozen_until) : null,
  };
}

module.exports = {
  parseDevice, clientIp, parseTs, toIso,
  createSession, checkSession, revokeSession, revokeOthers, listSessions,
  recordLogin, recordFailedLogin, listLogins,
  checkPassword, isValidPin, setPin, clearPin, requirePin,
  isFrozenRow, requireNotFrozen, freeze, unfreeze, status, FROZEN_MSG,
};
