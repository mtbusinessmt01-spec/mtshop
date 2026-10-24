// AirDrop xizmati: yaqinlikni aniqlash (GPS), real-time (SSE) va gift tashlash.
// Joylashuv faqat server xotirasida, qisqa muddat saqlanadi (bazaga yozilmaydi).
const db = require('./db');
const push = require('./push');
const profileSvc = require('./profile');

const RADIUS_KEY = 'airdrop_radius_m';
const DEFAULT_RADIUS_M = 30;
// Aniqlik darajalari:
//  - aniq   (<= PRECISE_ACC_M): telefon GPS'i — masofa to'g'ridan-to'g'ri radiusga solishtiriladi
//  - taxminiy (PRECISE..COARSE_MAX_ACC_M): noutbuk/Wi-Fi joylashuvi — aniqlik xatosi hisobga olinadi
//  - ishonchsiz (> COARSE_MAX_ACC_M): odatda IP bo'yicha joylashuv — hech kim ko'rinmaydi
const PRECISE_ACC_M = Number(process.env.AIRDROP_MAX_ACCURACY_M) || 50;
const COARSE_MAX_ACC_M = Number(process.env.AIRDROP_COARSE_MAX_M) || 500;
const TOL_CAP_SAME_NET_M = 300;   // bir Wi-Fi (bir xil public IP) bo'lsa — xato uchun ruxsat etilgan eng ko'p qo'shimcha masofa
const TOL_CAP_OTHER_NET_M = 120;  // turli tarmoq bo'lsa — kamroq
const LEAVE_K = 1.35;             // "yaqin" bo'lib bo'lgach, chiqib ketish chegarasi 35% kengroq (Wi-Fi joylashuvi sakrab turmasligi uchun)
const LOC_TTL_MS = 20 * 1000;     // joylashuv shu muddatdan eski bo'lsa — foydalanuvchi "ko'rinmaydi"
const DROP_TTL_MS = 30 * 1000;    // qabul qiluvchi javob berishi uchun vaqt
const MIN_UPDATE_MS = 1500;       // bitta foydalanuvchidan joylashuv yuborish chastotasi cheklovi

// userId -> { lat, lng, acc, ts, streams:Set<res> }
const presence = new Map();

class AirdropError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

async function getRadius() {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(RADIUS_KEY);
  const v = row ? parseFloat(row.value) : NaN;
  return isNaN(v) || v < 3 || v > 200 ? DEFAULT_RADIUS_M : v;
}

async function setRadius(raw) {
  const v = parseFloat(raw);
  if (isNaN(v) || v < 3 || v > 200) throw new AirdropError(400, "Masofa 3 dan 200 metrgacha bo'lishi kerak");
  const r = Math.round(v);
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(RADIUS_KEY, String(r));
  return r;
}

// Haversine: ikki nuqta orasidagi masofa (metr)
function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isFresh(p) { return p && Date.now() - p.ts <= LOC_TTL_MS; }

function accMode(acc) { return acc <= PRECISE_ACC_M ? 'precise' : acc <= COARSE_MAX_ACC_M ? 'wifi' : 'weak'; }

// Tarmoq kaliti: bir xil Wi-Fi/router orqasidagi qurilmalar bir xil public IP bilan ko'rinadi (IPv6 uchun /64)
function expandV6(ip) {
  const parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length > 1 ? Array(Math.max(0, 8 - head.length - tail.length)).fill('0') : [];
  return [...head, ...fill, ...tail].map(x => x.padStart(4, '0'));
}
function netKey(req) {
  const ip = String((req && req.ip) || '').replace(/^::ffff:/, '').split('%')[0];
  if (!ip) return null;
  return ip.includes(':') ? expandV6(ip).slice(0, 4).join(':') : ip;
}

// Yaqin juftliklar (hysteresis uchun): "a:b"
const nearPairs = new Set();
const pairKey = (x, y) => (x < y ? `${x}:${y}` : `${y}:${x}`);
function dropPairs(userId) {
  for (const k of [...nearPairs]) { const [x, y] = k.split(':'); if (+x === userId || +y === userId) nearPairs.delete(k); }
}

// "Yaqin" bo'lishi: ikkalasi yangi joylashuv bergan va masofa <= radius (+ aniqlik xatosi).
// Ikkalasi ham aniq (GPS) bo'lsa — faqat radius. Birortasi taxminiy (noutbuk/Wi-Fi) bo'lsa —
// radiusga ikkala aniqlikning yig'indisi qo'shiladi (bir tarmoqda 300 m, turli tarmoqda 120 m dan oshmaydi).
function relation(idA, a, idB, b, radius) {
  if (!isFresh(a) || !isFresh(b)) return { near: false };
  if (a.acc > COARSE_MAX_ACC_M || b.acc > COARSE_MAX_ACC_M) return { near: false, lowAccuracy: true };
  const d = distanceM(a, b);
  const sameNet = !!a.net && a.net === b.net;
  const coarse = a.acc > PRECISE_ACC_M || b.acc > PRECISE_ACC_M;
  let limit = radius;
  if (coarse) limit += Math.min(a.acc + b.acc, sameNet ? TOL_CAP_SAME_NET_M : TOL_CAP_OTHER_NET_M);
  const key = pairKey(idA, idB);
  if (nearPairs.has(key)) limit *= LEAVE_K;
  const near = d <= limit;
  if (near) nearPairs.add(key); else nearPairs.delete(key);
  return { near, distance: d, coarse, sameNet };
}

function sse(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* ulanish uzilgan */ }
}

function emitTo(userId, event, data) {
  const p = presence.get(userId);
  if (!p) return false;
  for (const res of p.streams) sse(res, event, data);
  return p.streams.size > 0;
}

function addStream(userId, res, net) {
  let p = presence.get(userId);
  if (!p) { p = { lat: null, lng: null, acc: Infinity, ts: 0, streams: new Set(), lastUpdate: 0, net: null }; presence.set(userId, p); }
  if (net) p.net = net;
  p.streams.add(res);
}

function removeStream(userId, res) {
  const p = presence.get(userId);
  if (!p) return;
  p.streams.delete(res);
  if (!p.streams.size) { presence.delete(userId); dropPairs(userId); broadcastNearby(); }
}

function updateLocation(userId, body) {
  const lat = Number(body && body.lat), lng = Number(body && body.lng), acc = Number(body && body.accuracy);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AirdropError(400, "Joylashuv noto'g'ri");
  }
  const p = presence.get(userId);
  if (!p) throw new AirdropError(409, "Avval AirDrop sahifasini oching (real-time ulanish yo'q)");
  const now = Date.now();
  if (now - p.lastUpdate < MIN_UPDATE_MS) return false;    // juda tez-tez yuborilsa e'tiborsiz
  p.lat = lat; p.lng = lng; p.acc = isFinite(acc) && acc >= 0 ? acc : Infinity; p.ts = now; p.lastUpdate = now;
  return true;
}

// Berilgan foydalanuvchiga yaqin bo'lganlar (koordinatalarsiz — faqat profil ma'lumoti)
async function nearbyFor(userId) {
  const me = presence.get(userId);
  const myAcc = me && isFinite(me.acc) ? Math.round(me.acc) : null;
  if (!isFresh(me)) return { users: [], myAccuracy: myAcc, weak: false, mode: 'wait' };
  const radius = await getRadius();
  const rels = new Map();
  for (const [id, p] of presence) {
    if (id === userId) continue;
    const r = relation(userId, me, id, p, radius);
    if (r.near) rels.set(id, r);
  }
  const mode = accMode(me.acc), weak = mode === 'weak';
  if (!rels.size) return { users: [], myAccuracy: myAcc, weak, mode };
  const ids = [...rels.keys()];
  const rows = await db.prepare(
    `SELECT id, username, full_name, avatar_ver FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND is_blocked = 0`
  ).all(...ids);
  return {
    users: rows.map(u => ({ ...profileSvc.withAvatar(u), same_net: !!(rels.get(u.id) || {}).sameNet })),
    myAccuracy: myAcc, weak, mode,
  };
}

let broadcastTimer = null;
function broadcastNearby() {      // ro'yxat o'zgarganda hammaga (tez-tez emas) yangilab yuboriladi
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    for (const [id] of presence) {
      try { emitTo(id, 'nearby', await nearbyFor(id)); } catch (e) { console.error('AirDrop broadcast xatosi:', e.message); }
    }
  }, 400);
}

// Tasdiqlangan ("armed") gift: PIN swipe'dan oldin, giftni tanlash paytida tekshiriladi.
// Tasdiq qisqa muddat amal qiladi va yuborilgach ishlatilib bo'ladi.
const ARM_TTL_MS = 3 * 60 * 1000;
const armed = new Map();      // userId -> { inventoryId, until }

async function arm(userId, inventoryId) {
  const item = await db.prepare('SELECT id, trade_id FROM user_gifts WHERE id = ? AND user_id = ?').get(inventoryId, userId);
  if (!item) throw new AirdropError(404, 'Gift inventaringizda topilmadi');
  if (item.trade_id) throw new AirdropError(409, "Bu gift Trade'da band");
  armed.set(userId, { inventoryId: item.id, until: Date.now() + ARM_TTL_MS });
  return { ok: true, expires_in: ARM_TTL_MS / 1000 };
}

// Swipe balandligi (0..1) — faqat "yaqin" bo'lgan, oqimi ochiq qabul qiluvchiga uzatiladi. Hech narsa saqlanmaydi.
const lastGlow = new Map();   // fromUserId -> ts
async function glow(fromUserId, toUserId, level) {
  const lv = Math.max(0, Math.min(1, Number(level)));
  if (!isFinite(lv)) throw new AirdropError(400, "Daraja noto'g'ri");
  const now = Date.now();
  if (now - (lastGlow.get(fromUserId) || 0) < 60) return false;      // juda tez-tez yuborilmasin
  lastGlow.set(fromUserId, now);
  const a = presence.get(fromUserId), b = presence.get(toUserId);
  if (!a || !b || !relation(fromUserId, a, toUserId, b, await getRadius()).near) return false;
  emitTo(toUserId, 'glow', { from_id: fromUserId, level: Math.round(lv * 100) / 100 });
  return true;
}

async function send(fromUser, toUserId, inventoryId) {
  const ar = armed.get(fromUser.id);
  if (!ar || ar.inventoryId !== inventoryId || ar.until < Date.now()) {
    throw new AirdropError(403, 'Giftni qayta tanlang va PIN bilan tasdiqlang', { need_arm: true });
  }
  const radius = await getRadius();
  const a = presence.get(fromUser.id), b = presence.get(toUserId);
  const rel = relation(fromUser.id, a, toUserId, b, radius);
  if (!rel.near) {
    throw new AirdropError(409, rel.lowAccuracy
      ? "Joylashuv aniqligi juda past (500 m dan yomon) — Wi-Fi'ga ulaning yoki ochiq joyga chiqib qayta urinib ko'ring"
      : "Foydalanuvchi yaqinda emas yoki AirDrop sahifasida emas");
  }
  const target = await db.prepare('SELECT id, username, is_blocked FROM users WHERE id = ?').get(toUserId);
  if (!target || target.is_blocked) throw new AirdropError(404, 'Foydalanuvchi topilmadi');

  const item = await db.prepare('SELECT * FROM user_gifts WHERE id = ? AND user_id = ?').get(inventoryId, fromUser.id);
  if (!item) throw new AirdropError(404, 'Gift inventaringizda topilmadi');
  if (item.trade_id) throw new AirdropError(409, "Bu gift Trade'da band");

  await expireStale();
  const expires = new Date(Date.now() + DROP_TTL_MS).toISOString();
  let id;
  try {
    const r = await db.prepare(`
      INSERT INTO airdrops (from_user_id, to_user_id, user_gift_id, gift_id, distance_m, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fromUser.id, toUserId, item.id, item.gift_id, Math.round(rel.distance * 10) / 10, expires);
    id = r.lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/i.test(e.message || '')) throw new AirdropError(409, 'Avvalgi AirDrop hali javobsiz — kuting yoki bekor qiling');
    throw e;
  }

  const g = await db.prepare('SELECT name, image_url FROM gifts WHERE id = ?').get(item.gift_id);
  const me = await db.prepare('SELECT id, username, full_name, avatar_ver FROM users WHERE id = ?').get(fromUser.id);
  const delivered = emitTo(toUserId, 'incoming', {
    id, expires_at: expires, from: profileSvc.withAvatar(me),
    gift: { name: g ? g.name : 'Gift', image_url: g ? g.image_url : null },
  });
  if (!delivered) {   // qabul qiluvchining oqimi uzilgan bo'lsa — tashlab bo'lmaydi
    await db.prepare("UPDATE airdrops SET status = 'EXPIRED', resolved_at = datetime('now') WHERE id = ?").run(id);
    throw new AirdropError(409, 'Foydalanuvchi hozir AirDrop sahifasida emas');
  }
  armed.delete(fromUser.id);
  return { id, expires_at: expires };
}

// Qabul qilish: bitta haqiqiy tranzaksiyada status va gift egasi birga o'zgaradi
async function accept(userId, airdropId) {
  let row;
  try {
    row = await db.withTx(async (tx) => {
      const d = await tx.prepare('SELECT * FROM airdrops WHERE id = ? AND to_user_id = ?').get(airdropId, userId);
      if (!d) throw new AirdropError(404, 'AirDrop topilmadi');
      if (d.status !== 'PENDING') throw new AirdropError(409, 'Bu AirDrop allaqachon yakunlangan');
      if (d.expires_at <= new Date().toISOString()) {
        await tx.prepare("UPDATE airdrops SET status = 'EXPIRED', resolved_at = datetime('now') WHERE id = ?").run(d.id);
        return { ...d, status: 'EXPIRED' };
      }
      const mv = await tx.prepare(
        'UPDATE user_gifts SET user_id = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL'
      ).run(userId, d.user_gift_id, d.from_user_id);
      if (!mv.changes) {
        await tx.prepare("UPDATE airdrops SET status = 'FAILED', resolved_at = datetime('now') WHERE id = ?").run(d.id);
        return { ...d, status: 'FAILED' };
      }
      await tx.prepare(
        "INSERT INTO transfers (from_user_id, to_user_id, item_type, gift_id, is_anonymous, seen) VALUES (?, ?, 'gift', ?, 0, 1)"
      ).run(d.from_user_id, userId, d.gift_id);
      await tx.prepare("UPDATE airdrops SET status = 'ACCEPTED', resolved_at = datetime('now') WHERE id = ?").run(d.id);
      return { ...d, status: 'ACCEPTED' };
    });
  } catch (e) {
    throw e;
  }
  emitTo(row.from_user_id, 'result', { id: row.id, status: row.status });
  if (row.status === 'FAILED') throw new AirdropError(409, "Gift endi mavjud emas (sotilgan yoki band qilingan)");
  if (row.status === 'EXPIRED') throw new AirdropError(410, 'Vaqt tugadi');
  return { ok: true };
}

async function resolveSimple(userId, airdropId, who, status) {
  const col = who === 'receiver' ? 'to_user_id' : 'from_user_id';
  const r = await db.prepare(
    `UPDATE airdrops SET status = ?, resolved_at = datetime('now') WHERE id = ? AND ${col} = ? AND status = 'PENDING'`
  ).run(status, airdropId, userId);
  if (!r.changes) throw new AirdropError(409, 'AirDrop topilmadi yoki allaqachon yakunlangan');
  const d = await db.prepare('SELECT from_user_id, to_user_id FROM airdrops WHERE id = ?').get(airdropId);
  emitTo(d.from_user_id, 'result', { id: airdropId, status });
  if (status === 'CANCELLED') emitTo(d.to_user_id, 'cancelled', { id: airdropId });
}

async function expireStale() {
  const rows = await db.prepare("SELECT id, from_user_id, to_user_id FROM airdrops WHERE status = 'PENDING' AND expires_at <= ?")
    .all(new Date().toISOString());
  for (const d of rows) {
    const r = await db.prepare("UPDATE airdrops SET status = 'EXPIRED', resolved_at = datetime('now') WHERE id = ? AND status = 'PENDING'").run(d.id);
    if (r.changes) {
      emitTo(d.from_user_id, 'result', { id: d.id, status: 'EXPIRED' });
      emitTo(d.to_user_id, 'cancelled', { id: d.id });
    }
  }
}

// Eskirgan joylashuvlar va muddati o'tgan airdroplarni tozalash
function startScheduler() {
  setInterval(async () => {
    try {
      let changed = false;
      for (const [id, p] of presence) if (p.ts && !isFresh(p) && p.lat !== null) { p.lat = p.lng = null; p.acc = Infinity; p.ts = 0; dropPairs(id); changed = true; }
      if (changed) broadcastNearby();
      for (const [id, ts] of lastGlow) if (Date.now() - ts > 60000) lastGlow.delete(id);
      for (const [id, a] of armed) if (a.until < Date.now()) armed.delete(id);
      await expireStale();
    } catch (e) { console.error('AirDrop scheduler xatosi:', e.message); }
  }, 5000).unref();
}

module.exports = {
  AirdropError, netKey, limits: () => ({ precise: PRECISE_ACC_M, coarse_max: COARSE_MAX_ACC_M }),
  getRadius, setRadius, addStream, removeStream, updateLocation,
  nearbyFor, broadcastNearby, glow, arm, send, accept, resolveSimple, startScheduler, sse,
};
