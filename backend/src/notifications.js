// Bildirishnomalar markazi (inbox), kategoriyalar bo'yicha sozlamalar va "tinch rejim".
// Bu modul faqat bazaga tayanadi (push.js ni chaqirmaydi) — push.js shu modulni ishlatadi.
const db = require('./db');

// Kategoriyalar. locked = true bo'lsa foydalanuvchi o'chira olmaydi (xavfsizlik ogohlantirishlari).
// Eslatma: Daily Case hech qanday bildirishnoma yubormaydi, shuning uchun u bu yerda yo'q.
const CATEGORIES = {
  pet:      { label: 'Pet',                     desc: "Och qoldi, kasal bo'ldi, o'lish xavfi",          locked: false },
  gifts:    { label: "Trade va sovg'alar",      desc: "Trade taklifi, kelgan sovg'a, noyob yutuq",      locked: false },
  credit:   { label: 'Kredit va kafillik',      desc: "To'lov muddati, kafillik so'rovlari va javoblar", locked: false },
  news:     { label: 'Yangiliklar va eventlar', desc: 'Yangi versiya, admin xabarlari',                  locked: false },
  security: { label: 'Xavfsizlik',              desc: "Begona qurilmadan kirish, PIN xatolari (o'chirib bo'lmaydi)", locked: true },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const DEFAULT_CATEGORY = 'news';

const MAX_PER_USER = 100;      // har foydalanuvchida eng ko'pi bilan shuncha bildirishnoma saqlanadi
const KEEP_DAYS = 30;          // eski bildirishnomalar shuncha kundan keyin o'chadi
const DEFAULT_TZ = 300;        // O'zbekiston (UTC+5), daqiqalarda

function normCategory(c) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, c) ? c : DEFAULT_CATEGORY;
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// Mahalliy fayl bazasida (yoki band paytda) yozuv "database is locked" bilan qaytishi mumkin —
// bildirishnoma yo'qolib qolmasligi uchun qisqa kutib qayta urinamiz.
const isBusy = (e) => /SQLITE_BUSY|database is locked/i.test((e && e.message) || '');
async function retryBusy(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isBusy(e) || i >= 8) throw e;
      await new Promise(r => setTimeout(r, 25 * (i + 1)));
    }
  }
}

// ---------- Inbox ----------

// Tanlangan foydalanuvchilarga markazga yozadi. payload.replace = true bo'lsa, shu tag'dagi
// hali o'qilmagan eski yozuv almashtiriladi (masalan pet "och" -> "kasal" bo'lganda ro'yxat tozaligicha qoladi).
async function addInbox(userIds, payload) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  const category = normCategory(payload.category);
  const title = clip(payload.title, 80) || 'MTshop';
  const body = clip(payload.body, 300);
  const url = clip(payload.url, 300) || '/index.html';
  const tag = payload.tag ? clip(payload.tag, 100) : null;

  for (const id of ids) {
    if (payload.replace && tag) {
      await retryBusy(() => db.prepare('DELETE FROM notifications WHERE user_id = ? AND tag = ? AND is_read = 0').run(id, tag));
    }
    await retryBusy(() => db.prepare(
      'INSERT INTO notifications (user_id, category, title, body, url, tag) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, category, title, body, url, tag));
  }
  return ids.length;
}

// Hamma (bloklanmagan) foydalanuvchilarga — admin e'loni va yangi versiya uchun
async function addInboxForAll(payload) {
  const category = normCategory(payload.category);
  const title = clip(payload.title, 80) || 'MTshop';
  const body = clip(payload.body, 300);
  const url = clip(payload.url, 300) || '/index.html';
  const tag = payload.tag ? clip(payload.tag, 100) : null;
  const r = await retryBusy(() => db.prepare(
    `INSERT INTO notifications (user_id, category, title, body, url, tag)
     SELECT id, ?, ?, ?, ?, ? FROM users WHERE is_blocked = 0`
  ).run(category, title, body, url, tag));
  return r.changes;
}

function iso(sqliteDate) {
  const s = String(sqliteDate || '');
  return s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
}

async function list(userId, opts) {
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 40, 1), 100);
  const before = parseInt(o.before, 10) || 0;
  const rows = before
    ? await db.prepare('SELECT * FROM notifications WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(userId, before, limit)
    : await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  return rows.map(r => ({
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    url: r.url,
    is_read: !!r.is_read,
    created_at: iso(r.created_at),
  }));
}

async function unreadCount(userId) {
  const r = await db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return Number(r.c);
}

async function markRead(userId, ids) {
  if (ids === 'all') {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
    return;
  }
  const list = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 200);
  if (!list.length) return;
  const marks = list.map(() => '?').join(',');
  await db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${marks})`).run(userId, ...list);
}

async function remove(userId, id) {
  await db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, Number(id));
}

async function clearAll(userId) {
  await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
}

// Eski yozuvlarni tozalaydi (scheduler har 10 daqiqada chaqiradi)
async function prune() {
  await retryBusy(() => db.prepare(`DELETE FROM notifications WHERE created_at < datetime('now', ?)`).run(`-${KEEP_DAYS} days`));
  await retryBusy(() => db.prepare(`
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn FROM notifications
      ) WHERE rn > ?
    )
  `).run(MAX_PER_USER));
}

// ---------- Sozlamalar ----------

function minToHHMM(m) {
  const mm = Math.min(Math.max(Number(m) || 0, 0), 1439);
  return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
}

function hhmmToMin(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function getPrefs(userId) {
  const rows = await db.prepare('SELECT category, push_enabled FROM notification_prefs WHERE user_id = ?').all(userId);
  const map = Object.fromEntries(rows.map(r => [r.category, Number(r.push_enabled) !== 0]));
  const s = await db.prepare('SELECT * FROM notification_settings WHERE user_id = ?').get(userId);
  return {
    categories: CATEGORY_KEYS.map(k => ({
      key: k,
      label: CATEGORIES[k].label,
      desc: CATEGORIES[k].desc,
      locked: CATEGORIES[k].locked,
      push: CATEGORIES[k].locked ? true : (k in map ? map[k] : true),
    })),
    quiet: {
      enabled: !!(s && Number(s.quiet_enabled)),
      start: minToHHMM(s ? s.quiet_start : 1380),   // 23:00
      end: minToHHMM(s ? s.quiet_end : 420),        // 07:00
    },
  };
}

// body: { prefs: {pet:true, ...}, quiet: {enabled, start:'23:00', end:'07:00'}, tz_offset: 300 }
async function savePrefs(userId, body) {
  const b = body || {};
  if (b.prefs && typeof b.prefs === 'object') {
    for (const k of CATEGORY_KEYS) {
      if (CATEGORIES[k].locked) continue;
      if (typeof b.prefs[k] !== 'boolean') continue;
      await db.prepare(`
        INSERT INTO notification_prefs (user_id, category, push_enabled) VALUES (?, ?, ?)
        ON CONFLICT(user_id, category) DO UPDATE SET push_enabled = excluded.push_enabled
      `).run(userId, k, b.prefs[k] ? 1 : 0);
    }
  }
  if (b.quiet && typeof b.quiet === 'object') {
    const start = hhmmToMin(b.quiet.start);
    const end = hhmmToMin(b.quiet.end);
    if (start === null || end === null) throw new Error("Vaqt formati noto'g'ri (masalan 23:00)");
    let tz = parseInt(b.tz_offset, 10);
    if (!Number.isFinite(tz) || tz < -840 || tz > 840) tz = DEFAULT_TZ;
    await db.prepare(`
      INSERT INTO notification_settings (user_id, quiet_enabled, quiet_start, quiet_end, tz_offset) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET quiet_enabled = excluded.quiet_enabled, quiet_start = excluded.quiet_start,
        quiet_end = excluded.quiet_end, tz_offset = excluded.tz_offset
    `).run(userId, b.quiet.enabled ? 1 : 0, start, end, tz);
  }
}

function inQuiet(s, nowMs) {
  const a = Number(s.quiet_start), b = Number(s.quiet_end);
  if (a === b) return false;
  const tz = (s.tz_offset === null || s.tz_offset === undefined) ? DEFAULT_TZ : Number(s.tz_offset);
  const local = new Date(nowMs + tz * 60000);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}

// Push obunalari + (LEFT JOIN) foydalanuvchi sozlamalari BITTA so'rovda olinadi: send vaqtida qo'shimcha SELECT'lar
// bo'lmasligi uchun (fayl bazasida ko'p parallel o'qish/yozish "database is locked" ga olib kelishi mumkin).
const SUBS_WITH_PREFS_SQL = `
  SELECT ps.*, np.push_enabled AS np_enabled, ns.quiet_enabled AS q_enabled,
         ns.quiet_start AS q_start, ns.quiet_end AS q_end, ns.tz_offset AS q_tz
  FROM push_subscriptions ps
  LEFT JOIN notification_prefs np ON np.user_id = ps.user_id AND np.category = ?
  LEFT JOIN notification_settings ns ON ns.user_id = ps.user_id`;

// Obuna qatorlaridan shu kategoriyada push olishi MUMKINlarini qoldiradi (o'chirganlar va tinch rejimdagilar chiqadi).
// Xavfsizlik kategoriyasi hamisha ruxsat etiladi.
function filterSubs(rows, category, nowMs) {
  const cat = normCategory(category);
  if (CATEGORIES[cat].locked) return rows;
  const now = nowMs || Date.now();
  return rows.filter(r => {
    if (r.np_enabled !== null && r.np_enabled !== undefined && Number(r.np_enabled) === 0) return false;
    if (Number(r.q_enabled) === 1 &&
        inQuiet({ quiet_start: r.q_start, quiet_end: r.q_end, tz_offset: r.q_tz }, now)) return false;
    return true;
  });
}

module.exports = {
  CATEGORIES, CATEGORY_KEYS, normCategory,
  addInbox, addInboxForAll, list, unreadCount, markRead, remove, clearAll, prune,
  getPrefs, savePrefs, SUBS_WITH_PREFS_SQL, filterSubs,
};
