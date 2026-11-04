// Kirishdagi (login) urinishlarni cheklash: parolni terib topishdan himoya.
// Xotirada saqlanadi (server qayta ishga tushsa tozalanadi) — bepul Render uchun yetarli va oddiy.
//  * Bir IP + username juftligi: 10 daqiqada ko'pi bilan 8 ta xato
//  * Bir IP: 10 daqiqada ko'pi bilan 40 ta xato
// Juftlik bo'yicha cheklangani uchun begona odam boshqa birovning hisobini butunlay qulflab qo'ya olmaydi.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_PAIR = 8;
const MAX_PER_IP = 40;
const MAX_KEYS = 20000;

const hits = new Map();   // key -> { n, first }

function norm(username) { return String(username || '').trim().toLowerCase().slice(0, 64); }
function pairKey(ip, username) { return `p|${ip}|${norm(username)}`; }
function ipKey(ip) { return `i|${ip}`; }

function waitFor(key, max) {
  const e = hits.get(key);
  if (!e) return 0;
  const left = e.first + WINDOW_MS - Date.now();
  if (left <= 0) { hits.delete(key); return 0; }
  return e.n >= max ? left : 0;
}

function bump(key) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now - e.first > WINDOW_MS) hits.set(key, { n: 1, first: now });
  else e.n += 1;
}

// Necha millisekund kutish kerak (0 — kirishga ruxsat)
function check(ip, username) {
  return Math.max(waitFor(pairKey(ip, username), MAX_PER_PAIR), waitFor(ipKey(ip), MAX_PER_IP));
}

function fail(ip, username) {
  if (hits.size > MAX_KEYS) hits.clear();
  bump(pairKey(ip, username));
  bump(ipKey(ip));
}

function success(ip, username) {
  hits.delete(pairKey(ip, username));
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) if (now - e.first > WINDOW_MS) hits.delete(k);
}, 60 * 1000).unref();

module.exports = { check, fail, success };
