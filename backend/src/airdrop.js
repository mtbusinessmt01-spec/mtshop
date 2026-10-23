// AirDrop xizmati: yaqinlikni aniqlash (GPS), real-time (SSE) va gift tashlash.
// Joylashuv faqat server xotirasida, qisqa muddat saqlanadi (bazaga yozilmaydi).
const db = require('./db');
const push = require('./push');
const profileSvc = require('./profile');

const RADIUS_KEY = 'airdrop_radius_m';
const DEFAULT_RADIUS_M = 30;
const MAX_ACCURACY_M = 50;        // GPS aniqligi bundan yomon bo'lsa, yaqin deb hisoblanmaydi
const LOC_TTL_MS = 20 * 1000;     // joylashuv shu muddatdan eski bo'lsa — foydalanuvchi "ko'rinmaydi"
const DROP_TTL_MS = 30 * 1000;    // qabul qiluvchi javob berishi uchun vaqt
const MIN_UPDATE_MS = 1500;       // bitta foydalanuvchidan joylashuv yuborish chastotasi cheklovi

// userId -> { lat, lng, acc, ts, streams:Set<res> }
const presence = new Map();

class AirdropError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

// "Yaqin" bo'lishi: ikkalasi yangi joylashuv bergan, aniqligi yetarli va masofa <= radius.
// Aniqlik xatosi hisobga olinadi: masofa radius + ikkala aniqlikning kichigi doirasidan oshmasin.
function isNear(a, b, radius) {
  if (!isFresh(a) || !isFresh(b)) return { near: false };
  if (a.acc > MAX_ACCURACY_M || b.acc > MAX_ACCURACY_M) return { near: false, lowAccuracy: true };
  const d = distanceM(a, b);
  return { near: d <= radius, distance: d };
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

function addStream(userId, res) {
  let p = presence.get(userId);
  if (!p) { p = { lat: null, lng: null, acc: Infinity, ts: 0, streams: new Set(), lastUpdate: 0 }; presence.set(userId, p); }
  p.streams.add(res);
}

function removeStream(userId, res) {
  const p = presence.get(userId);
  if (!p) return;
  p.streams.delete(res);
  if (!p.streams.size) { presence.delete(userId); broadcastNearby(); }
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
  if (!isFresh(me)) return { users: [], myAccuracy: me && isFinite(me.acc) ? Math.round(me.acc) : null, weak: false };
  const radius = await getRadius();
  const ids = [];
  let weak = me.acc > MAX_ACCURACY_M;
  for (const [id, p] of presence) {
    if (id === userId) continue;
    const r = isNear(me, p, radius);
    if (r.near) ids.push(id);
  }
  if (!ids.length) return { users: [], myAccuracy: Math.round(me.acc), weak };
  const rows = await db.prepare(
    `SELECT id, username, full_name, avatar_ver FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND is_blocked = 0`
  ).all(...ids);
  return { users: rows.map(profileSvc.withAvatar), myAccuracy: Math.round(me.acc), weak };
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

async function send(fromUser, toUserId, inventoryId) {
  const radius = await getRadius();
  const a = presence.get(fromUser.id), b = presence.get(toUserId);
  const rel = isNear(a, b, radius);
  if (!rel.near) {
    throw new AirdropError(409, rel.lowAccuracy
      ? "GPS aniqligi past — ochiq joyga chiqib qayta urinib ko'ring"
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
      for (const [, p] of presence) if (p.ts && !isFresh(p) && p.lat !== null) { p.lat = p.lng = null; p.acc = Infinity; p.ts = 0; changed = true; }
      if (changed) broadcastNearby();
      await expireStale();
    } catch (e) { console.error('AirDrop scheduler xatosi:', e.message); }
  }, 5000).unref();
}

module.exports = {
  AirdropError, getRadius, setRadius, addStream, removeStream, updateLocation,
  nearbyFor, broadcastNearby, send, accept, resolveSimple, startScheduler, sse,
};
