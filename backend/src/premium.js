// Premium: sozlamalar (admin o'zgartiradi), faollikni tekshirish va imtiyozlar chegaralari.
// Imtiyozlar faqat Premium FAOL bo'lganda ishlaydi; muddat tugasa o'zi o'chadi (hech narsa o'chirilmaydi).
//   * komissiya: oddiy komissiyadan KAMROQ bo'lsa shuni oladi (hech qachon ko'p emas)
//   * gift sotish foizi, pet soni, qadash soni: oddiydan KO'P bo'lsa shuni oladi
//   * trade kutish vaqti: oddiydan KAM bo'lsa shuni oladi

const db = require('./db');

const BASE = { commission: 5, sell: 80, maxPets: 2, pinMax: 6, tradeCooldownMin: 20 };

const DEFS = {
  premium_price:              { def: 500, min: 0, max: 100000000, int: false },
  premium_days:               { def: 30,  min: 1, max: 3650,      int: true  },
  premium_commission_percent: { def: 1,   min: 0, max: 100,       int: false },
  premium_sell_percent:       { def: 90,  min: 1, max: 100,       int: false },
  premium_max_pets:           { def: 3,   min: 1, max: 20,        int: true  },
  premium_pin_max:            { def: 10,  min: 1, max: 30,        int: true  },
  premium_trade_cooldown_min: { def: 5,   min: 0, max: 1440,      int: true  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clean(key, raw) {
  const d = DEFS[key];
  let v = parseFloat(raw);
  if (!isFinite(v)) return null;
  v = Math.round(v * 100) / 100;
  if (d.int) v = Math.round(v);
  if (v < d.min || v > d.max) return null;
  return v;
}

async function getSettings() {
  const rows = await db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'premium\\_%' ESCAPE '\\'").all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  const out = {};
  for (const key of Object.keys(DEFS)) {
    const v = clean(key, map[key]);
    out[key] = v === null ? DEFS[key].def : v;
  }
  return out;
}

async function saveSettings(input) {
  const saved = {};
  for (const key of Object.keys(DEFS)) {
    if (input[key] === undefined) continue;
    const v = clean(key, input[key]);
    if (v === null) return { error: `"${key}" qiymati noto'g'ri (${DEFS[key].min} dan ${DEFS[key].max} gacha bo'lishi kerak)` };
    saved[key] = v;
  }
  for (const [key, v] of Object.entries(saved)) {
    await db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, String(v));
  }
  return { ok: true };
}

function isActiveUntil(until, nowMs = Date.now()) {
  if (!until) return false;
  const t = new Date(until).getTime();
  return isFinite(t) && t > nowMs;
}

async function untilOf(userId) {
  const r = await db.prepare('SELECT premium_until FROM users WHERE id = ?').get(userId);
  return r ? r.premium_until : null;
}

async function isPremium(userId) {
  return isActiveUntil(await untilOf(userId));
}

// { userId -> true } faqat faol Premium egalari uchun
async function premiumMap(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT id, premium_until FROM users WHERE id IN (${marks})`).all(...ids);
  const now = Date.now();
  rows.forEach(r => { if (isActiveUntil(r.premium_until, now)) out.set(r.id, true); });
  return out;
}

async function baseCommission() {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'transfer_commission_percent'").get();
  const p = row ? parseFloat(row.value) : NaN;
  return isNaN(p) || p < 0 ? BASE.commission : p;
}

// Foydalanuvchi uchun amaldagi chegaralar (Premium bo'lsa yaxshilangan)
async function limitsFor(userId) {
  const [prem, s, baseComm] = await Promise.all([isPremium(userId), getSettings(), baseCommission()]);
  return {
    premium: prem,
    commission_percent: prem ? Math.min(baseComm, s.premium_commission_percent) : baseComm,
    sell_percent: prem ? Math.max(BASE.sell, s.premium_sell_percent) : BASE.sell,
    max_pets: prem ? Math.max(BASE.maxPets, s.premium_max_pets) : BASE.maxPets,
    pin_max: prem ? Math.max(BASE.pinMax, s.premium_pin_max) : BASE.pinMax,
    trade_cooldown_min: prem ? Math.min(BASE.tradeCooldownMin, s.premium_trade_cooldown_min) : BASE.tradeCooldownMin,
  };
}

// Ko'rsatish uchun to'liq holat (/api/premium va /api/auth/me)
async function statusFor(userId) {
  const [until, s, lim, baseComm] = await Promise.all([untilOf(userId), getSettings(), limitsFor(userId), baseCommission()]);
  const active = isActiveUntil(until);
  const daysLeft = active ? Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / DAY_MS)) : 0;
  return {
    active,
    until: active ? until : null,
    days_left: daysLeft,
    price: s.premium_price,
    days: s.premium_days,
    normal: { commission_percent: baseComm, sell_percent: BASE.sell, max_pets: BASE.maxPets, pin_max: BASE.pinMax, trade_cooldown_min: BASE.tradeCooldownMin },
    perks: {
      commission_percent: Math.min(baseComm, s.premium_commission_percent),
      sell_percent: Math.max(BASE.sell, s.premium_sell_percent),
      max_pets: Math.max(BASE.maxPets, s.premium_max_pets),
      pin_max: Math.max(BASE.pinMax, s.premium_pin_max),
      trade_cooldown_min: Math.min(BASE.tradeCooldownMin, s.premium_trade_cooldown_min),
    },
    // hozirgi (amaldagi) qiymatlar — frontend hisob-kitoblari uchun
    effective: {
      commission_percent: lim.commission_percent, sell_percent: lim.sell_percent, max_pets: lim.max_pets,
      pin_max: lim.pin_max, trade_cooldown_min: lim.trade_cooldown_min,
    },
  };
}

function addDays(fromMs, days) {
  return new Date(fromMs + days * DAY_MS).toISOString();
}

// Coin evaziga sotib olish / uzaytirish (atomik)
async function buy(userId) {
  const s = await getSettings();
  let result;
  await db.withTx(async (tx) => {
    const u = await tx.prepare('SELECT coin_balance, premium_until FROM users WHERE id = ?').get(userId);
    if (!u) throw new Error('NO_USER');
    const nowMs = Date.now();
    const startMs = isActiveUntil(u.premium_until, nowMs) ? new Date(u.premium_until).getTime() : nowMs;
    const newUntil = addDays(startMs, s.premium_days);
    const upd = await tx.prepare(
      'UPDATE users SET coin_balance = coin_balance - ?, premium_until = ? WHERE id = ? AND coin_balance >= ?'
    ).run(s.premium_price, newUntil, userId, s.premium_price);
    if (!upd.changes) throw new Error('NO_COIN');
    await tx.prepare("INSERT INTO premium_log (user_id, kind, days, price, until_after) VALUES (?, 'purchase', ?, ?, ?)")
      .run(userId, s.premium_days, s.premium_price, newUntil);
    result = { until: newUntil, price: s.premium_price, days: s.premium_days };
  });
  const bal = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
  return { ...result, coin_balance: bal.coin_balance };
}

// Admin: kun berish (mavjud muddatga qo'shiladi)
async function grant(userId, days) {
  let until;
  await db.withTx(async (tx) => {
    const u = await tx.prepare('SELECT premium_until FROM users WHERE id = ?').get(userId);
    const nowMs = Date.now();
    const startMs = isActiveUntil(u && u.premium_until, nowMs) ? new Date(u.premium_until).getTime() : nowMs;
    until = addDays(startMs, days);
    await tx.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(until, userId);
    await tx.prepare("INSERT INTO premium_log (user_id, kind, days, price, until_after) VALUES (?, 'admin_grant', ?, 0, ?)").run(userId, days, until);
  });
  return until;
}

async function revoke(userId) {
  await db.prepare('UPDATE users SET premium_until = NULL WHERE id = ?').run(userId);
  await db.prepare("INSERT INTO premium_log (user_id, kind, days, price, until_after) VALUES (?, 'admin_revoke', 0, 0, NULL)").run(userId);
}

async function activeUsers() {
  const rows = await db.prepare('SELECT id, username, premium_until FROM users WHERE premium_until IS NOT NULL ORDER BY premium_until DESC').all();
  const now = Date.now();
  return rows.filter(r => isActiveUntil(r.premium_until, now));
}

module.exports = { BASE, DEFS, getSettings, saveSettings, isPremium, premiumMap, limitsFor, statusFor, buy, grant, revoke, activeUsers };
