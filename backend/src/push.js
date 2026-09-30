const webpush = require('web-push');
const db = require('./db');

const HOUR_MS = 60 * 60 * 1000;

// Pet holati chegaralari (pets.js bilan bir xil): 24 soatda kasal, 36 soatda o'ladi
const PET_SICK_WARN_HOURS = 20;   // kasal bo'lishiga 4 soat qolganda ogohlantiramiz
const PET_SICK_HOURS = 24;
const PET_DEATH_WARN_HOURS = 32;  // o'lishiga 4 soat qolganda ogohlantiramiz
const PET_DEATH_HOURS = 36;

const CREDIT_WARN_MS = 24 * HOUR_MS; // kredit to'lov muddatiga 24 soat qolganda eslatamiz
const SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;

let publicKey = null;
let ready = false;

// ---------- VAPID kalitlari ----------
// Kalitlar birinchi ishga tushishda avtomatik yaratilib, Turso bazasida saqlanadi
// (shuning uchun hosting qayta deploy qilinsa ham o'zgarmaydi va qo'lda sozlash shart emas).
async function initPush() {
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;

  if (!pub || !priv) {
    const rows = await db.prepare("SELECT key, value FROM settings WHERE key IN ('vapid_public','vapid_private')").all();
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    pub = map.vapid_public;
    priv = map.vapid_private;

    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(pub);
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(priv);
      console.log('Push uchun yangi VAPID kalitlari yaratildi.');
    }
  }

  const subject = process.env.VAPID_SUBJECT || 'https://mtshop-p6gp.onrender.com';
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
  ready = true;
}

function getPublicKey() {
  return publicKey;
}

// ---------- Obunalar ----------
async function saveSubscription(userId, sub) {
  const endpoint = sub && sub.endpoint;
  const p256dh = sub && sub.keys && sub.keys.p256dh;
  const auth = sub && sub.keys && sub.keys.auth;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !p256dh || !auth) {
    throw new Error('Obuna ma\'lumoti noto\'g\'ri');
  }
  // Bir xil qurilma boshqa akkauntda ham kirishi mumkin — endpoint bo'yicha yangilaymiz
  await db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(userId, endpoint, p256dh, auth);
}

async function removeSubscription(userId, endpoint) {
  await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

// ---------- Yuborish ----------
function buildPayload(p) {
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  return JSON.stringify({
    title: clip(p.title, 80) || 'MTshop',
    body: clip(p.body, 300),
    icon: '/logo.jpg',
    image: p.image || undefined,
    url: p.url || '/index.html',
    tag: p.tag || undefined,
  });
}

async function sendToSubscriptions(subs, payload) {
  if (!ready || !subs.length) return { sent: 0, failed: 0, removed: 0 };
  const body = buildPayload(payload);
  let sent = 0, failed = 0, removed = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 * 24 }
      );
      sent++;
    } catch (e) {
      // 404/410 — qurilma obunani bekor qilgan yoki eskirgan: bazadan olib tashlaymiz
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        removed++;
      } else {
        failed++;
        console.error('Push yuborishda xato:', e && (e.statusCode || e.message));
      }
    }
  }));
  return { sent, failed, removed };
}

async function sendToUsers(userIds, payload) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return { sent: 0, failed: 0, removed: 0, users: 0 };
  const marks = ids.map(() => '?').join(',');
  const subs = await db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${marks})`).all(...ids);
  const result = await sendToSubscriptions(subs, payload);
  return { ...result, users: new Set(subs.map(s => s.user_id)).size };
}

async function sendToAll(payload) {
  const subs = await db.prepare('SELECT * FROM push_subscriptions').all();
  const result = await sendToSubscriptions(subs, payload);
  return { ...result, users: new Set(subs.map(s => s.user_id)).size };
}

// Hodisalar (transfer, case ochilishi va h.k.) uchun: xato bo'lsa ham asosiy jarayonni to'xtatmaydi
function notifyUser(userId, payload) {
  sendToUsers([userId], payload).catch(e => console.error('notifyUser xatosi:', e.message));
}

// ---------- Avtomatik eslatmalar (pet va kredit) ----------
function parseDate(str) {
  if (!str) return NaN;
  // "2026-09-18 08:39:40" (SQLite, UTC) yoki ISO formatlarni bir xil o'qiymiz
  const s = String(str);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').getTime();
}

// Shu holat uchun eslatma avval yuborilmagan bo'lsagina true qaytaradi
async function claimNotification(userId, kind, refId, marker) {
  const r = await db.prepare(
    'INSERT OR IGNORE INTO notification_log (user_id, kind, ref_id, marker) VALUES (?, ?, ?, ?)'
  ).run(userId, kind, refId, String(marker));
  return r.changes > 0;
}

let running = false;

async function runScheduledChecks() {
  if (!ready || running) return;
  running = true;
  try {
    const subRows = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
    const subscribed = new Set(subRows.map(r => r.user_id));
    if (!subscribed.size) return;
    const now = Date.now();

    // 1) Pet'lar
    const pets = await db.prepare(`
      SELECT up.id, up.user_id, up.name, up.last_fed_at, pt.name AS type_name
      FROM user_pets up JOIN pet_types pt ON pt.id = up.pet_type_id
      WHERE up.status != 'dead'
    `).all();

    for (const p of pets) {
      if (!subscribed.has(p.user_id)) continue;
      const hours = (now - parseDate(p.last_fed_at)) / HOUR_MS;
      if (!(hours >= PET_SICK_WARN_HOURS) || hours >= PET_DEATH_HOURS) continue;
      const petName = p.name || p.type_name;

      if (hours >= PET_DEATH_WARN_HOURS) {
        if (await claimNotification(p.user_id, 'pet_death_soon', p.id, p.last_fed_at)) {
          const left = Math.max(1, Math.ceil(PET_DEATH_HOURS - hours));
          await sendToUsers([p.user_id], {
            title: `💀 ${petName} o'lish arafasida!`,
            body: `Taxminan ${left} soatdan keyin o'ladi. Zudlik bilan ovqatlantiring yoki davolang.`,
            url: '/index.html#mypet',
            tag: `pet-${p.id}`,
          });
        }
      } else if (hours < PET_SICK_HOURS) {
        if (await claimNotification(p.user_id, 'pet_sick_soon', p.id, p.last_fed_at)) {
          const left = Math.max(1, Math.ceil(PET_SICK_HOURS - hours));
          await sendToUsers([p.user_id], {
            title: `🍖 ${petName} ochqayapti`,
            body: `Taxminan ${left} soatdan keyin kasal bo'ladi. Ovqatlantirishni unutmang!`,
            url: '/index.html#mypet',
            tag: `pet-${p.id}`,
          });
        }
      }
    }

    // 2) Kredit to'lovlari
    const credits = await db.prepare(`
      SELECT uc.id, uc.user_id, uc.next_payment_at, uc.weekly_payment, uc.remaining_amount, ct.name AS type_name
      FROM user_credits uc JOIN credit_types ct ON ct.id = uc.credit_type_id
      WHERE uc.status = 'active'
    `).all();

    for (const c of credits) {
      if (!subscribed.has(c.user_id)) continue;
      const due = parseDate(c.next_payment_at);
      if (Number.isNaN(due)) continue;
      const diff = due - now;
      const amount = Math.round(Math.min(c.weekly_payment, c.remaining_amount) * 100) / 100;

      if (diff <= 0) {
        if (await claimNotification(c.user_id, 'credit_overdue', c.id, c.next_payment_at)) {
          await sendToUsers([c.user_id], {
            title: '⚠️ Kredit to\'lovi kechikdi',
            body: `"${c.type_name}" bo'yicha ${amount} coin to'lov muddati o'tdi. Jarima yozilishi mumkin — tezroq to'lang.`,
            url: '/index.html#kreditlar',
            tag: `credit-${c.id}`,
          });
        }
      } else if (diff <= CREDIT_WARN_MS) {
        if (await claimNotification(c.user_id, 'credit_due_soon', c.id, c.next_payment_at)) {
          const hoursLeft = Math.max(1, Math.ceil(diff / HOUR_MS));
          await sendToUsers([c.user_id], {
            title: '💳 Kredit to\'lovi yaqinlashmoqda',
            body: `"${c.type_name}" bo'yicha ${amount} coin to'lovga taxminan ${hoursLeft} soat qoldi.`,
            url: '/index.html#kreditlar',
            tag: `credit-${c.id}`,
          });
        }
      }
    }
  } catch (e) {
    console.error('Avtomatik eslatmalarda xato:', e.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  // Server ishga tushgach biroz kutib birinchi tekshiruvni qilamiz, keyin har 10 daqiqada
  setTimeout(runScheduledChecks, 30 * 1000);
  setInterval(runScheduledChecks, SCHEDULER_INTERVAL_MS);
}

module.exports = {
  initPush, getPublicKey, saveSubscription, removeSubscription,
  sendToUsers, sendToAll, notifyUser, runScheduledChecks, startScheduler, parseDate,
};
