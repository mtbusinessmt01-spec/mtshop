// MTshop — Gift Trade tizimi (xizmat qatlami)
//
// Asosiy tamoyillar:
//  * Hamma tekshiruv serverda. Client yuborgan vaqt, balans, gift ID, status — hech qaysisiga ishonilmaydi.
//  * Har bir o'zgartiruvchi amal db.withTx() ichida (BEGIN IMMEDIATE ... COMMIT). Yozuvchi tranzaksiyalar
//    baza darajasida ketma-ket bajariladi, shuning uchun race condition yo'q.
//  * Status o'tishlari faqat shartli UPDATE ... WHERE status = '...' orqali (o'zgargan qator soni tekshiriladi).
//  * Gift: offerga qo'shilganda user_gifts.trade_id orqali "band" qilinadi (sotish/yuborish/ovqatlantirish bloklanadi).
//  * Coin: offerga qo'yilganda mavjud coin_balance'dan yechilib trade'da (escrow) turadi; bekor bo'lsa qaytariladi.
//  * "Bir vaqtda 1 ta ACTIVE trade" — trade_active_users.user_id PRIMARY KEY orqali baza darajasida kafolatlanadi.

const db = require('./db');
const push = require('./push');
const profile = require('./profile');

const REQUEST_TTL_MS = 5 * 60 * 1000;     // request 5 daqiqa amal qiladi
const COOLDOWN_MS = 20 * 60 * 1000;       // 20 daqiqada faqat 1 ta request
const MAX_GIFTS_PER_SIDE = 5;
const MAX_COIN_PER_SIDE = 100000;
const MAX_MESSAGE_LEN = 500;
const MAX_MESSAGES_PER_TRADE = 500;
const MSG_RATE_COUNT = 8;                 // 10 soniyada ko'pi bilan 8 ta xabar
const MSG_RATE_WINDOW_MS = 10 * 1000;

const STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'FAILED'];

class TradeError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

// Tranzaksiya ichida holat saqlanishi kerak bo'lgan xatolar uchun: return soft(...) — commit bo'ladi, keyin xato qaytariladi
function soft(status, message, extra) {
  return { __soft: new TradeError(status, message, extra) };
}

const nowIso = () => new Date().toISOString();

async function tradeTx(fn) {
  const out = await db.withTx(async (tx) => {
    const after = [];
    const result = await fn(tx, after);
    return { result, after };
  });
  for (const f of out.after) {
    try { f(); } catch (e) { console.error('Trade after-hook xatosi:', e.message); }
  }
  if (out.result && out.result.__soft) throw out.result.__soft;
  return out.result;
}

function parseId(v) {
  const s = String(v == null ? '' : v);
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// ---------- Audit log va bildirishnomalar ----------

async function log(tx, tradeId, userId, action, details) {
  await tx.prepare('INSERT INTO trade_logs (trade_id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(tradeId || null, userId || null, action, details ? String(details).slice(0, 500) : null, nowIso());
}

// Sayt ichidagi bildirishnoma + (commit'dan keyin) push. dedupe=true: o'qilmagan xuddi shunday turdagi bildirishnoma bo'lsa qo'shilmaydi.
async function notify(tx, after, userId, tradeId, type, text, opts) {
  const o = opts || {};
  if (o.dedupe) {
    const dup = await tx.prepare(
      'SELECT id FROM trade_notifications WHERE user_id = ? AND trade_id = ? AND type = ? AND seen = 0 LIMIT 1'
    ).get(userId, tradeId, type);
    if (dup) return;
  }
  await tx.prepare(
    'INSERT INTO trade_notifications (user_id, trade_id, type, text, seen, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(userId, tradeId || null, type, text, nowIso());
  after.push(() => push.notifyUser(userId, {
    title: 'MTshop Trade',
    body: text,
    url: '/index.html#trade',
    tag: `trade-${tradeId}-${type}`,
  }));
}

// ---------- Yordamchilar ----------

async function getUser(tx, id) {
  return tx.prepare('SELECT id, username, is_blocked, is_admin, coin_balance FROM users WHERE id = ?').get(id);
}

function sideOf(trade, userId) {
  if (trade.user_a_id === userId) return 'a';
  if (trade.user_b_id === userId) return 'b';
  return null;
}

function otherId(trade, side) {
  return side === 'a' ? trade.user_b_id : trade.user_a_id;
}

// Trade'ni olib, foydalanuvchi ishtirokchi ekanini tekshiradi. Begona uchun "topilmadi" (mavjudligini ham oshkor qilmaydi).
async function loadForUser(tx, tradeId, userId) {
  const id = parseId(tradeId);
  if (!id) throw new TradeError(404, 'Trade topilmadi');
  const t = await tx.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!t) throw new TradeError(404, 'Trade topilmadi');
  const side = sideOf(t, userId);
  if (!side) throw new TradeError(403, 'Access denied');
  return { t, side };
}

async function assertActiveUser(tx, userId) {
  const u = await getUser(tx, userId);
  if (!u) throw new TradeError(401, 'Foydalanuvchi topilmadi');
  if (u.is_blocked) throw new TradeError(403, 'Hisobingiz bloklangan');
  return u;
}

async function usernameOf(tx, id) {
  const u = await tx.prepare('SELECT username FROM users WHERE id = ?').get(id);
  return u ? u.username : '?';
}

// ---------- Muddati o'tgan requestlar ----------

// PENDING va expires_at <= hozir bo'lsa — EXPIRED. Server vaqti bo'yicha; client vaqtiga ishonilmaydi.
async function expirePending(tx, after, extraWhere, extraArgs) {
  const now = nowIso();
  const due = await tx.prepare(
    `SELECT * FROM trades WHERE status = 'PENDING' AND expires_at <= ? ${extraWhere || ''}`
  ).all(now, ...(extraArgs || []));
  for (const t of due) {
    const r = await tx.prepare(
      "UPDATE trades SET status = 'EXPIRED', status_reason = 'timeout', expired_at = ? WHERE id = ? AND status = 'PENDING'"
    ).run(now, t.id);
    if (!r.changes) continue;
    await log(tx, t.id, null, 'trade_expired', null);
    await notify(tx, after, t.user_a_id, t.id, 'expired', 'Trade Request muddati tugadi.');
  }
  return due.length;
}

// Arzon tekshiruv: muddati o'tgan request yo'q bo'lsa yozuvchi tranzaksiya ochilmaydi
async function sweepExpired() {
  const now = nowIso();
  const row = await db.prepare("SELECT COUNT(*) AS c FROM trades WHERE status = 'PENDING' AND expires_at <= ?").get(now);
  if (!row || !row.c) return 0;
  return tradeTx(async (tx, after) => expirePending(tx, after));
}

// ---------- 1-2-3. Request yaratish ----------

async function createRequest(userId, targetUsername) {
  const uname = String(targetUsername == null ? '' : targetUsername).trim();
  if (!uname || uname.length > 64) throw new TradeError(400, 'Foydalanuvchi username kerak');

  return tradeTx(async (tx, after) => {
    const me = await assertActiveUser(tx, userId);
    const target = await tx.prepare('SELECT id, username, is_blocked FROM users WHERE username = ?').get(uname);
    if (!target) throw new TradeError(404, 'Bunday foydalanuvchi topilmadi');
    if (target.id === me.id) throw new TradeError(400, "O'zingiz bilan Trade qila olmaysiz");
    if (target.is_blocked) throw new TradeError(400, 'Bu foydalanuvchi bilan Trade qilib bo\'lmaydi');

    // Sizda ACTIVE trade bor — yangi request yuborib bo'lmaydi (3-test)
    if (await tx.prepare('SELECT 1 AS x FROM trade_active_users WHERE user_id = ?').get(me.id)) {
      throw new TradeError(409, 'Sizda faol Trade bor. Avval uni yakunlang yoki bekor qiling.', { code: 'ACTIVE_TRADE' });
    }
    if (await tx.prepare('SELECT 1 AS x FROM trade_active_users WHERE user_id = ?').get(target.id)) {
      throw new TradeError(409, 'Bu foydalanuvchi hozir boshqa Trade ichida.', { code: 'TARGET_BUSY' });
    }

    // Eskirgan o'z requestingni yopamiz (unique index va cooldown to'g'ri ishlashi uchun)
    await expirePending(tx, after, 'AND user_a_id = ?', [me.id]);
    if (await tx.prepare("SELECT 1 AS x FROM trades WHERE user_a_id = ? AND status = 'PENDING'").get(me.id)) {
      throw new TradeError(409, 'Sizning faol Trade Requestingiz bor. Muddati tugashini kuting yoki bekor qiling.', { code: 'PENDING_EXISTS' });
    }

    // 20 daqiqalik cooldown — atomik: shartli UPDATE faqat vaqt o'tgan bo'lsa ishlaydi (server vaqti)
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - COOLDOWN_MS).toISOString();
    const upd = await tx.prepare(
      'UPDATE users SET last_trade_request_at = ? WHERE id = ? AND (last_trade_request_at IS NULL OR last_trade_request_at <= ?)'
    ).run(new Date(nowMs).toISOString(), me.id, cutoff);
    if (!upd.changes) {
      const last = await tx.prepare('SELECT last_trade_request_at AS l FROM users WHERE id = ?').get(me.id);
      const wait = Math.max(1, Math.ceil((new Date(last.l).getTime() + COOLDOWN_MS - nowMs) / 1000));
      throw new TradeError(429, `20 daqiqalik cooldown: yana ${Math.ceil(wait / 60)} daqiqadan keyin urinib ko'ring.`,
        { code: 'COOLDOWN', retry_after_seconds: wait });
    }

    const created = new Date(nowMs).toISOString();
    const expires = new Date(nowMs + REQUEST_TTL_MS).toISOString();
    const r = await tx.prepare(
      "INSERT INTO trades (user_a_id, user_b_id, status, expires_at, created_at) VALUES (?, ?, 'PENDING', ?, ?)"
    ).run(me.id, target.id, expires, created);

    await log(tx, r.lastInsertRowid, me.id, 'trade_created', `to=${target.id}`);
    await notify(tx, after, target.id, r.lastInsertRowid, 'request', `🔄 @${me.username} siz bilan Trade boshlamoqchi.`);
    return { id: r.lastInsertRowid, status: 'PENDING', expires_at: expires, server_now: nowMs, to: target.username };
  });
}

// ---------- 5-6-7. Accept ----------

async function acceptRequest(userId, tradeId) {
  return tradeTx(async (tx, after) => {
    await assertActiveUser(tx, userId);
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (side !== 'b') throw new TradeError(403, "Requestni faqat qabul qiluvchi qabul qila oladi");

    const now = nowIso();
    if (t.status !== 'PENDING') {
      throw new TradeError(409, 'Bu Trade Request endi faol emas.', { code: 'NOT_ACTIVE', status: t.status });
    }
    if (t.expires_at <= now) {
      // Muddati o'tgan: EXPIRED qilib saqlaymiz (commit bo'ladi), keyin xato qaytaramiz
      await expirePending(tx, after, 'AND id = ?', [t.id]);
      return soft(410, "Trade Request muddati tugagan. Accept qilib bo'lmaydi.", { code: 'EXPIRED', status: 'EXPIRED' });
    }

    const a = t.user_a_id;
    const b = t.user_b_id;
    const ua = await getUser(tx, a);
    if (!ua || ua.is_blocked) {
      await tx.prepare("UPDATE trades SET status = 'CANCELLED', status_reason = 'sender_unavailable', cancelled_at = ? WHERE id = ? AND status = 'PENDING'").run(now, t.id);
      await log(tx, t.id, userId, 'trade_cancelled', 'sender_unavailable');
      return soft(409, 'Bu Trade Request endi faol emas.', { code: 'NOT_ACTIVE' });
    }

    // Yuboruvchi boshqa trade'ni allaqachon boshlagan (race holati): bu request REJECTED
    if (await tx.prepare('SELECT 1 AS x FROM trade_active_users WHERE user_id = ?').get(a)) {
      await tx.prepare("UPDATE trades SET status = 'REJECTED', status_reason = 'sender_busy', rejected_at = ? WHERE id = ? AND status = 'PENDING'").run(now, t.id);
      await log(tx, t.id, userId, 'trade_rejected', 'sender_busy');
      return soft(409, "Bu foydalanuvchi boshqa Trade'ni boshladi.", { code: 'SENDER_BUSY', status: 'REJECTED' });
    }
    // Qabul qiluvchi o'zi boshqa trade ichida
    if (await tx.prepare('SELECT 1 AS x FROM trade_active_users WHERE user_id = ?').get(b)) {
      throw new TradeError(409, "Siz hozir boshqa Trade ichidasiz.", { code: 'ACTIVE_TRADE' });
    }

    // PENDING -> ACTIVE (shartli UPDATE: boshqa tomonidan o'zgargan bo'lsa 0 qator)
    const act = await tx.prepare(
      "UPDATE trades SET status = 'ACTIVE', accepted_at = ?, escrow = 'held' WHERE id = ? AND status = 'PENDING' AND expires_at > ?"
    ).run(now, t.id, now);
    if (!act.changes) throw new TradeError(409, 'Bu Trade Request endi faol emas.', { code: 'NOT_ACTIVE' });

    // Baza darajasidagi himoya: user_id PRIMARY KEY — ikkinchi ACTIVE trade qo'shilmaydi (xato -> ROLLBACK)
    await tx.prepare('INSERT INTO trade_active_users (user_id, trade_id) VALUES (?, ?)').run(a, t.id);
    await tx.prepare('INSERT INTO trade_active_users (user_id, trade_id) VALUES (?, ?)').run(b, t.id);

    // Ikkala foydalanuvchiga tegishli qolgan PENDING requestlarni bekor qilamiz
    const others = await tx.prepare(
      `SELECT * FROM trades WHERE status = 'PENDING' AND id != ?
         AND (user_a_id IN (?, ?) OR user_b_id IN (?, ?))`
    ).all(t.id, a, b, a, b);
    for (const o of others) {
      const r = await tx.prepare(
        "UPDATE trades SET status = 'CANCELLED', status_reason = 'superseded', cancelled_at = ? WHERE id = ? AND status = 'PENDING'"
      ).run(now, o.id);
      if (!r.changes) continue;
      await log(tx, o.id, userId, 'trade_cancelled', 'superseded');
      if (o.user_a_id !== a && o.user_a_id !== b) {
        await notify(tx, after, o.user_a_id, o.id, 'cancelled', "Trade Requestingiz bekor qilindi: foydalanuvchi boshqa Trade'ni boshladi.");
      }
    }

    const me = await getUser(tx, b);
    await log(tx, t.id, userId, 'trade_accepted', null);
    await notify(tx, after, a, t.id, 'accepted', `@${me.username} Trade Requestingizni qabul qildi.`);
    return { ok: true, id: t.id, status: 'ACTIVE' };
  });
}

// ---------- Reject / sender bekor qilishi (PENDING) ----------

async function declineRequest(userId, tradeId) {
  return tradeTx(async (tx, after) => {
    await assertActiveUser(tx, userId);
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (t.status !== 'PENDING') {
      throw new TradeError(409, 'Bu Trade Request endi faol emas.', { code: 'NOT_ACTIVE', status: t.status });
    }
    const now = nowIso();
    const me = await getUser(tx, userId);
    if (side === 'b') {
      const r = await tx.prepare("UPDATE trades SET status = 'REJECTED', status_reason = 'rejected_by_receiver', rejected_at = ? WHERE id = ? AND status = 'PENDING'").run(now, t.id);
      if (!r.changes) throw new TradeError(409, 'Bu Trade Request endi faol emas.');
      await log(tx, t.id, userId, 'trade_rejected', null);
      await notify(tx, after, t.user_a_id, t.id, 'rejected', `@${me.username} Trade Requestingizni rad etdi.`);
      return { ok: true, status: 'REJECTED' };
    }
    const r = await tx.prepare("UPDATE trades SET status = 'CANCELLED', status_reason = 'cancelled_by_sender', cancelled_at = ? WHERE id = ? AND status = 'PENDING'").run(now, t.id);
    if (!r.changes) throw new TradeError(409, 'Bu Trade Request endi faol emas.');
    await log(tx, t.id, userId, 'trade_cancelled', 'cancelled_by_sender');
    return { ok: true, status: 'CANCELLED' };
  });
}

// ---------- ACTIVE trade'ni yopish (cancel / fail): hamma narsa egasiga qaytadi ----------

async function releaseAndClose(tx, after, t, newStatus, reason, actorId) {
  const now = nowIso();
  const col = newStatus === 'FAILED' ? 'failed_at' : 'cancelled_at';
  // ACTIVE -> CANCELLED/FAILED. COMPLETED bo'lsa 0 qator o'zgaradi va hech narsa qaytarilmaydi.
  const r = await tx.prepare(
    `UPDATE trades SET status = ?, status_reason = ?, ${col} = ?, escrow = CASE WHEN escrow = 'held' THEN 'released' ELSE escrow END
       WHERE id = ? AND status = 'ACTIVE'`
  ).run(newStatus, reason, now, t.id);
  if (!r.changes) return false;

  // Escrow'dagi coinlar egasiga qaytadi
  if (t.escrow === 'held') {
    if (t.a_coin > 0) await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(t.a_coin, t.user_a_id);
    if (t.b_coin > 0) await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(t.b_coin, t.user_b_id);
  }
  // Giftlar band holatdan chiqadi
  await tx.prepare('UPDATE user_gifts SET trade_id = NULL WHERE trade_id = ?').run(t.id);
  await tx.prepare('DELETE FROM trade_active_users WHERE trade_id = ?').run(t.id);

  if (newStatus === 'FAILED') {
    await log(tx, t.id, actorId, 'trade_failed', reason);
    for (const uid of [t.user_a_id, t.user_b_id]) {
      await notify(tx, after, uid, t.id, 'failed', `Trade #${t.id} bajarilmadi. Gift va coinlaringiz qaytarildi.`);
    }
  } else {
    await log(tx, t.id, actorId, 'trade_cancelled', reason);
  }
  return true;
}

async function cancelTrade(userId, tradeId) {
  return tradeTx(async (tx, after) => {
    await assertActiveUser(tx, userId);
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (t.status === 'COMPLETED') throw new TradeError(409, "Yakunlangan Trade'ni bekor qilib bo'lmaydi.", { code: 'COMPLETED' });
    if (t.status === 'PENDING') {
      // PENDING bo'lsa — decline/cancel mantiqi
      const now = nowIso();
      const r = await tx.prepare("UPDATE trades SET status = 'CANCELLED', status_reason = ?, cancelled_at = ? WHERE id = ? AND status = 'PENDING'")
        .run(side === 'a' ? 'cancelled_by_sender' : 'cancelled_by_receiver', now, t.id);
      if (!r.changes) throw new TradeError(409, 'Bu Trade Request endi faol emas.');
      await log(tx, t.id, userId, 'trade_cancelled', null);
      return { ok: true, status: 'CANCELLED' };
    }
    if (t.status !== 'ACTIVE') throw new TradeError(409, 'Bu Trade endi faol emas.', { code: 'NOT_ACTIVE', status: t.status });

    const ok = await releaseAndClose(tx, after, t, 'CANCELLED', `cancelled_by_${side}`, userId);
    if (!ok) throw new TradeError(409, 'Bu Trade endi faol emas.');
    const me = await getUser(tx, userId);
    await notify(tx, after, otherId(t, side), t.id, 'cancelled', `@${me.username} Trade #${t.id} ni bekor qildi.`);
    return { ok: true, status: 'CANCELLED' };
  });
}

// ---------- Offer ----------

async function loadActiveForEdit(tx, tradeId, userId) {
  await assertActiveUser(tx, userId);
  const { t, side } = await loadForUser(tx, tradeId, userId);
  if (t.status !== 'ACTIVE') throw new TradeError(409, 'Bu Trade faol emas.', { code: 'NOT_ACTIVE', status: t.status });
  if (t[side + '_locked']) {
    throw new TradeError(409, 'Offer lock qilingan. Avval "Unlock & Edit" ni bosing.', { code: 'LOCKED' });
  }
  return { t, side };
}

// Offer o'zgargach ikkala tomonning lock va confirm holati reset qilinadi
async function resetLocks(tx, after, t, side, userId) {
  const wasReady = t.a_locked || t.b_locked || t.a_confirmed || t.b_confirmed;
  await tx.prepare('UPDATE trades SET a_locked = 0, b_locked = 0, a_confirmed = 0, b_confirmed = 0 WHERE id = ? AND status = ?')
    .run(t.id, 'ACTIVE');
  const me = await getUser(tx, userId);
  await notify(tx, after, otherId(t, side), t.id, 'offer_changed',
    `@${me.username} Trade offerini o'zgartirdi.`, { dedupe: true });
  return wasReady;
}

async function addGift(userId, tradeId, userGiftId) {
  const ugId = parseId(userGiftId);
  if (!ugId) throw new TradeError(400, "Gift noto'g'ri");
  return tradeTx(async (tx, after) => {
    const { t, side } = await loadActiveForEdit(tx, tradeId, userId);

    const cnt = await tx.prepare('SELECT COUNT(*) AS c FROM trade_items WHERE trade_id = ? AND user_id = ?').get(t.id, userId);
    if (cnt.c >= MAX_GIFTS_PER_SIDE) throw new TradeError(400, `Bitta tomon ko'pi bilan ${MAX_GIFTS_PER_SIDE} ta gift taklif qila oladi.`);

    // Egalik va bo'shlikni DB ma'lumotlari bilan tekshiramiz (client ID'siga ishonmaymiz)
    const ug = await tx.prepare(
      'SELECT ug.id, ug.user_id, ug.gift_id, ug.trade_id, g.name FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id WHERE ug.id = ?'
    ).get(ugId);
    if (!ug || ug.user_id !== userId) throw new TradeError(404, 'Gift sizning inventaringizda topilmadi.');
    if (ug.trade_id) throw new TradeError(409, "Bu gift boshqa Trade'da band.");

    // Atomik band qilish: faqat hali bo'sh bo'lsa
    const res = await tx.prepare('UPDATE user_gifts SET trade_id = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(t.id, ugId, userId);
    if (!res.changes) throw new TradeError(409, "Bu gift band bo'lib qolgan.");

    await tx.prepare('INSERT INTO trade_items (trade_id, user_id, user_gift_id, gift_id, gift_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(t.id, userId, ugId, ug.gift_id, ug.name, nowIso());
    await resetLocks(tx, after, t, side, userId);
    await log(tx, t.id, userId, 'offer_added', `user_gift=${ugId}`);
    return { ok: true };
  });
}

async function removeGift(userId, tradeId, userGiftId) {
  const ugId = parseId(userGiftId);
  if (!ugId) throw new TradeError(400, "Gift noto'g'ri");
  return tradeTx(async (tx, after) => {
    const { t, side } = await loadActiveForEdit(tx, tradeId, userId);
    const del = await tx.prepare('DELETE FROM trade_items WHERE trade_id = ? AND user_id = ? AND user_gift_id = ?').run(t.id, userId, ugId);
    if (!del.changes) throw new TradeError(404, 'Offerda bunday gift yo\'q.');
    await tx.prepare('UPDATE user_gifts SET trade_id = NULL WHERE id = ? AND trade_id = ?').run(ugId, t.id);
    await resetLocks(tx, after, t, side, userId);
    await log(tx, t.id, userId, 'offer_removed', `user_gift=${ugId}`);
    return { ok: true };
  });
}

function parseCoin(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d{1,7}$/.test(v.trim())) return Number(v.trim());
  return null;
}

async function setCoin(userId, tradeId, amount) {
  const amt = parseCoin(amount);
  if (amt === null || amt < 0) throw new TradeError(400, "Coin butun son bo'lishi va 0 dan kichik bo'lmasligi kerak.");
  if (amt > MAX_COIN_PER_SIDE) throw new TradeError(400, `Bitta tomon ko'pi bilan ${MAX_COIN_PER_SIDE} coin taklif qila oladi.`);

  return tradeTx(async (tx, after) => {
    const { t, side } = await loadActiveForEdit(tx, tradeId, userId);
    const col = side + '_coin';
    const old = t[col];
    const delta = amt - old;

    if (delta > 0) {
      // Haqiqiy balansdan atomik yechamiz (escrow): balans yetmasa 0 qator
      const r = await tx.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?').run(delta, userId, delta);
      if (!r.changes) throw new TradeError(400, 'Coin yetarli emas.');
    } else if (delta < 0) {
      await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(-delta, userId);
    }
    if (delta !== 0) {
      const u = await tx.prepare(`UPDATE trades SET ${col} = ? WHERE id = ? AND status = 'ACTIVE' AND ${side}_locked = 0`).run(amt, t.id);
      if (!u.changes) throw new TradeError(409, "Offerni o'zgartirib bo'lmadi.");
      await resetLocks(tx, after, t, side, userId);
      await log(tx, t.id, userId, 'offer_updated', `coin=${amt}`);
    }
    const bal = await tx.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
    return { ok: true, coin: amt, coin_balance: bal.coin_balance };
  });
}

async function lockOffer(userId, tradeId) {
  return tradeTx(async (tx, after) => {
    await assertActiveUser(tx, userId);
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (t.status !== 'ACTIVE') throw new TradeError(409, 'Bu Trade faol emas.', { code: 'NOT_ACTIVE', status: t.status });
    if (t[side + '_locked']) return { ok: true, already: true };

    // Bo'sh offer lock qilinishi mumkin (sovg'a sifatida), lekin ikkala tomon ham bo'sh bo'lsa confirm'da rad etiladi
    const r = await tx.prepare(`UPDATE trades SET ${side}_locked = 1 WHERE id = ? AND status = 'ACTIVE' AND ${side}_locked = 0`).run(t.id);
    if (!r.changes) return { ok: true, already: true };
    await log(tx, t.id, userId, 'offer_locked', null);

    const fresh = await tx.prepare('SELECT * FROM trades WHERE id = ?').get(t.id);
    if (fresh.a_locked && fresh.b_locked) {
      for (const uid of [fresh.user_a_id, fresh.user_b_id]) {
        await notify(tx, after, uid, t.id, 'ready', 'Trade tasdiqlashga tayyor.', { dedupe: true });
      }
    }
    return { ok: true };
  });
}

async function unlockOffer(userId, tradeId) {
  return tradeTx(async (tx) => {
    await assertActiveUser(tx, userId);
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (t.status !== 'ACTIVE') throw new TradeError(409, 'Bu Trade faol emas.', { code: 'NOT_ACTIVE', status: t.status });
    // O'z lockini ochadi; tasdiqlashlar reset (eski holat asosida tasdiqlash bo'lmasligi uchun)
    await tx.prepare(`UPDATE trades SET ${side}_locked = 0, a_confirmed = 0, b_confirmed = 0 WHERE id = ? AND status = 'ACTIVE'`).run(t.id);
    await log(tx, t.id, userId, 'offer_unlocked', null);
    return { ok: true };
  });
}

// ---------- 15-16-17. Confirm va atomik yakunlash ----------

async function offerIsIntact(tx, t) {
  const items = await tx.prepare('SELECT user_id, user_gift_id FROM trade_items WHERE trade_id = ?').all(t.id);
  for (const it of items) {
    const ug = await tx.prepare('SELECT user_id, trade_id FROM user_gifts WHERE id = ?').get(it.user_gift_id);
    if (!ug || ug.user_id !== it.user_id || ug.trade_id !== t.id) return false;
  }
  return true;
}

async function completeInTx(tx, after, t) {
  const now = nowIso();
  // Bir martalik o'tish: ACTIVE -> COMPLETED. Ikkinchi urinishda 0 qator (idempotent himoya).
  const r = await tx.prepare(
    `UPDATE trades SET status = 'COMPLETED', completed_at = ?, escrow = 'settled'
       WHERE id = ? AND status = 'ACTIVE' AND escrow = 'held'
         AND a_locked = 1 AND b_locked = 1 AND a_confirmed = 1 AND b_confirmed = 1`
  ).run(now, t.id);
  if (!r.changes) throw new TradeError(409, 'Trade yakunlab bo\'lmaydi.', { code: 'NOT_READY' });

  const items = await tx.prepare('SELECT * FROM trade_items WHERE trade_id = ? ORDER BY id').all(t.id);
  for (const it of items) {
    const to = it.user_id === t.user_a_id ? t.user_b_id : t.user_a_id;
    // Egalik va band holatni qayta tekshirib, bir vaqtda ko'chiramiz; biror gift mos kelmasa — ROLLBACK
    const m = await tx.prepare('UPDATE user_gifts SET user_id = ?, trade_id = NULL WHERE id = ? AND user_id = ? AND trade_id = ?')
      .run(to, it.user_gift_id, it.user_id, t.id);
    if (!m.changes) throw new TradeIntegrityError(`gift ${it.user_gift_id} mos kelmadi`);
    await tx.prepare(
      "INSERT INTO transfers (from_user_id, to_user_id, item_type, gift_id, is_anonymous, seen, trade_id) VALUES (?, ?, 'gift', ?, 0, 1, ?)"
    ).run(it.user_id, to, it.gift_id, t.id);
  }

  // Coinlar allaqachon escrow'da (egasidan yechilgan) — qarshi tomonga qo'shiladi
  if (t.a_coin > 0) {
    await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(t.a_coin, t.user_b_id);
    await tx.prepare("INSERT INTO transfers (from_user_id, to_user_id, item_type, coin_amount, commission, is_anonymous, seen, trade_id) VALUES (?, ?, 'coin', ?, 0, 0, 1, ?)")
      .run(t.user_a_id, t.user_b_id, t.a_coin, t.id);
  }
  if (t.b_coin > 0) {
    await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(t.b_coin, t.user_a_id);
    await tx.prepare("INSERT INTO transfers (from_user_id, to_user_id, item_type, coin_amount, commission, is_anonymous, seen, trade_id) VALUES (?, ?, 'coin', ?, 0, 0, 1, ?)")
      .run(t.user_b_id, t.user_a_id, t.b_coin, t.id);
  }

  await tx.prepare('DELETE FROM trade_active_users WHERE trade_id = ?').run(t.id);
  await log(tx, t.id, null, 'trade_completed', null);
  for (const uid of [t.user_a_id, t.user_b_id]) {
    await notify(tx, after, uid, t.id, 'completed', `🎉 Trade #${t.id} muvaffaqiyatli yakunlandi.`);
  }
}

class TradeIntegrityError extends Error {}

async function confirmTrade(userId, tradeId) {
  let outcome;
  try {
    outcome = await tradeTx(async (tx, after) => {
      await assertActiveUser(tx, userId);
      const { t, side } = await loadForUser(tx, tradeId, userId);

      // Idempotent: allaqachon yakunlangan bo'lsa — qayta bajarilmaydi, joriy natija qaytariladi
      if (t.status === 'COMPLETED') return { ok: true, status: 'COMPLETED', already: true };
      if (t.status !== 'ACTIVE') throw new TradeError(409, 'Bu Trade faol emas.', { code: 'NOT_ACTIVE', status: t.status });
      if (!(t.a_locked && t.b_locked)) throw new TradeError(409, 'Ikkala tomon ham offerni lock qilishi kerak.', { code: 'NOT_LOCKED' });
      if (t[side + '_confirmed']) return { ok: true, status: 'ACTIVE', waiting: true, already: true };

      const total = (await tx.prepare('SELECT COUNT(*) AS c FROM trade_items WHERE trade_id = ?').get(t.id)).c + t.a_coin + t.b_coin;
      if (total === 0) throw new TradeError(400, "Ikkala offer ham bo'sh. Avval nimadir taklif qiling.", { code: 'EMPTY' });

      if (!(await offerIsIntact(tx, t))) throw new TradeIntegrityError('offer buzilgan');

      const c = await tx.prepare(
        `UPDATE trades SET ${side}_confirmed = 1 WHERE id = ? AND status = 'ACTIVE' AND a_locked = 1 AND b_locked = 1`
      ).run(t.id);
      if (!c.changes) throw new TradeError(409, "Holat o'zgargan. Qayta urinib ko'ring.");
      await log(tx, t.id, userId, 'trade_confirmed', null);

      const fresh = await tx.prepare('SELECT * FROM trades WHERE id = ?').get(t.id);
      if (fresh.a_confirmed && fresh.b_confirmed) {
        await completeInTx(tx, after, fresh);
        return { ok: true, status: 'COMPLETED' };
      }
      return { ok: true, status: 'ACTIVE', waiting: true };
    });
  } catch (e) {
    if (e instanceof TradeIntegrityError) {
      // Butun tranzaksiya ROLLBACK qilingan. Trade FAILED bo'ladi, hamma narsa egalariga qaytadi.
      console.error(`Trade #${tradeId} yakunlanmadi:`, e.message);
      await failTrade(tradeId, e.message);
      throw new TradeError(409, "Trade bajarilmadi: offerdagi narsalar o'zgargan. Gift va coinlaringiz qaytarildi.", { code: 'FAILED', status: 'FAILED' });
    }
    throw e;
  }
  return outcome;
}

async function failTrade(tradeId, reason) {
  const id = parseId(tradeId);
  if (!id) return;
  try {
    await tradeTx(async (tx, after) => {
      const t = await tx.prepare('SELECT * FROM trades WHERE id = ?').get(id);
      if (!t) return;
      await releaseAndClose(tx, after, t, 'FAILED', String(reason || 'failed').slice(0, 100), null);
    });
  } catch (e) {
    console.error('failTrade xatosi:', e.message);
  }
}

// ---------- Chat ----------

function cleanMessage(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ')   // boshqaruv belgilari va qator uzilishlari
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function postMessage(userId, tradeId, text) {
  const body = cleanMessage(text);
  if (!body) throw new TradeError(400, "Xabar bo'sh bo'lmasligi kerak");
  if (body.length > MAX_MESSAGE_LEN) throw new TradeError(400, `Xabar ${MAX_MESSAGE_LEN} belgidan oshmasligi kerak`);

  return tradeTx(async (tx) => {
    await assertActiveUser(tx, userId);
    const { t } = await loadForUser(tx, tradeId, userId);
    // Chat faqat ACTIVE trade uchun; COMPLETED/CANCELLED/... bo'lsa yangi xabar qabul qilinmaydi
    if (t.status !== 'ACTIVE') throw new TradeError(409, 'Trade tugagan — chat yopilgan.', { code: 'CHAT_CLOSED', status: t.status });

    const total = await tx.prepare('SELECT COUNT(*) AS c FROM trade_messages WHERE trade_id = ?').get(t.id);
    if (total.c >= MAX_MESSAGES_PER_TRADE) throw new TradeError(429, 'Bu Trade chatida xabarlar limiti tugadi.');
    const since = new Date(Date.now() - MSG_RATE_WINDOW_MS).toISOString();
    const recent = await tx.prepare('SELECT COUNT(*) AS c FROM trade_messages WHERE trade_id = ? AND user_id = ? AND created_at > ?').get(t.id, userId, since);
    if (recent.c >= MSG_RATE_COUNT) throw new TradeError(429, "Juda tez yozyapsiz. Biroz kuting.");

    const r = await tx.prepare('INSERT INTO trade_messages (trade_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(t.id, userId, body, nowIso());
    return { ok: true, id: r.lastInsertRowid };
  });
}

// ---------- Ko'rish (o'qish) ----------

function statusFlags(t, side) {
  const active = t.status === 'ACTIVE';
  const myLocked = !!t[side + '_locked'];
  const theirLocked = !!t[(side === 'a' ? 'b' : 'a') + '_locked'];
  const myConfirmed = !!t[side + '_confirmed'];
  return {
    edit: active && !myLocked,
    lock: active && !myLocked,
    unlock: active && myLocked,
    confirm: active && myLocked && theirLocked && !myConfirmed,
    cancel: active,
    chat: active,
  };
}

async function viewTrade(userId, tradeId, afterMsgId) {
  const id = parseId(tradeId);
  if (!id) throw new TradeError(404, 'Trade topilmadi');
  const t = await db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!t) throw new TradeError(404, 'Trade topilmadi');
  const side = sideOf(t, userId);
  if (!side) throw new TradeError(403, 'Access denied');   // boshqa user Trade ID orqali kira olmaydi
  if (t[side + '_hidden']) throw new TradeError(404, "Trade topilmadi (tarixdan o'chirilgan)");
  const oside = side === 'a' ? 'b' : 'a';

  const [ua, ub] = await Promise.all([
    db.prepare('SELECT id, username FROM users WHERE id = ?').get(t.user_a_id),
    db.prepare('SELECT id, username FROM users WHERE id = ?').get(t.user_b_id),
  ]);
  const me = side === 'a' ? ua : ub;
  const other = side === 'a' ? ub : ua;
  const emo = await profile.emojiMap([me.id, other.id]);   // emoji status (egalik va narx tekshirilgan)

  const items = await db.prepare(`
    SELECT ti.user_id, ti.user_gift_id, ti.gift_id, ti.gift_name,
           (SELECT COUNT(*) FROM user_gifts ug WHERE ug.id = ti.user_gift_id AND ug.trade_id = ti.trade_id AND ug.user_id = ti.user_id) AS present
    FROM trade_items ti WHERE ti.trade_id = ? ORDER BY ti.id
  `).all(t.id);
  const shape = (uid) => items.filter(i => i.user_id === uid).map(i => ({
    user_gift_id: i.user_gift_id,
    gift_id: i.gift_id,
    name: i.gift_name,
    missing: t.status === 'ACTIVE' && !i.present,
  }));

  const after = parseId(afterMsgId) || 0;
  const messages = await db.prepare(`
    SELECT m.id, m.user_id, m.body, m.created_at, u.username
    FROM trade_messages m JOIN users u ON u.id = m.user_id
    WHERE m.trade_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 200
  `).all(t.id, after);

  return {
    server_now: Date.now(),
    trade: {
      id: t.id, status: t.status, status_reason: t.status_reason,
      created_at: t.created_at, expires_at: t.expires_at, accepted_at: t.accepted_at,
      completed_at: t.completed_at, cancelled_at: t.cancelled_at, rejected_at: t.rejected_at,
      expired_at: t.expired_at, failed_at: t.failed_at,
    },
    me: { id: me.id, username: me.username, emoji_gift_id: emo.has(me.id) ? emo.get(me.id).gift_id : null },
    other: { id: other.id, username: other.username, emoji_gift_id: emo.has(other.id) ? emo.get(other.id).gift_id : null },
    my: { coin: t[side + '_coin'], locked: !!t[side + '_locked'], confirmed: !!t[side + '_confirmed'], gifts: shape(me.id) },
    their: { coin: t[oside + '_coin'], locked: !!t[oside + '_locked'], confirmed: !!t[oside + '_confirmed'], gifts: shape(other.id) },
    can: statusFlags(t, side),
    limits: { max_gifts: MAX_GIFTS_PER_SIDE, max_coin: MAX_COIN_PER_SIDE, max_message: MAX_MESSAGE_LEN },
    messages,
  };
}

// Offerga qo'shish mumkin bo'lgan giftlarim (band bo'lmaganlar)
async function availableGifts(userId) {
  return db.prepare(`
    SELECT ug.id AS user_gift_id, g.id AS gift_id, g.name, g.price
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ? AND ug.trade_id IS NULL
    ORDER BY g.price DESC, ug.id ASC
  `).all(userId);
}

async function summary(userId) {
  await sweepExpired();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const incoming = await db.prepare(`
    SELECT t.id, t.expires_at, t.created_at, t.user_a_id AS from_id, u.username AS from_username
    FROM trades t JOIN users u ON u.id = t.user_a_id
    WHERE t.user_b_id = ? AND t.status = 'PENDING' AND t.expires_at > ? ORDER BY t.id DESC LIMIT 10
  `).all(userId, now);

  const outgoing = await db.prepare(`
    SELECT t.id, t.expires_at, t.created_at, t.user_b_id AS to_id, u.username AS to_username
    FROM trades t JOIN users u ON u.id = t.user_b_id
    WHERE t.user_a_id = ? AND t.status = 'PENDING' AND t.expires_at > ? ORDER BY t.id DESC LIMIT 1
  `).all(userId, now);

  const act = await db.prepare(`
    SELECT t.id, t.user_a_id, t.user_b_id FROM trade_active_users au JOIN trades t ON t.id = au.trade_id WHERE au.user_id = ?
  `).get(userId);
  let active = null;
  if (act) {
    const oid = act.user_a_id === userId ? act.user_b_id : act.user_a_id;
    const ou = await db.prepare('SELECT username FROM users WHERE id = ?').get(oid);
    active = { id: act.id, with: ou ? ou.username : '?', with_id: oid };
  }

  // Banner va ro'yxatlarda username yonida emoji status ko'rsatish uchun
  const emo = await profile.emojiMap([
    ...incoming.map(t => t.from_id), ...outgoing.map(t => t.to_id), active ? active.with_id : 0,
  ]);
  const emojiOf = (id) => (emo.has(id) ? emo.get(id).gift_id : null);
  incoming.forEach(t => { t.emoji_gift_id = emojiOf(t.from_id); });
  outgoing.forEach(t => { t.emoji_gift_id = emojiOf(t.to_id); });
  if (active) active.emoji_gift_id = emojiOf(active.with_id);

  const notifications = await db.prepare(
    'SELECT id, trade_id, type, text, created_at FROM trade_notifications WHERE user_id = ? AND seen = 0 ORDER BY id ASC LIMIT 20'
  ).all(userId);

  const me = await db.prepare('SELECT last_trade_request_at AS l FROM users WHERE id = ?').get(userId);
  let cooldownUntil = null;
  if (me && me.l) {
    const until = new Date(me.l).getTime() + COOLDOWN_MS;
    if (until > nowMs) cooldownUntil = until;
  }

  return { server_now: nowMs, incoming, outgoing: outgoing[0] || null, active, notifications, cooldown_until: cooldownUntil, request_ttl_seconds: REQUEST_TTL_MS / 1000 };
}

async function markNotificationsSeen(userId, ids) {
  if (ids === 'all') {
    await db.prepare('UPDATE trade_notifications SET seen = 1 WHERE user_id = ? AND seen = 0').run(userId);
    return;
  }
  const list = (Array.isArray(ids) ? ids : []).map(parseId).filter(Boolean).slice(0, 50);
  for (const id of list) {
    await db.prepare('UPDATE trade_notifications SET seen = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  }
}

async function history(userId, limit) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const rows = await db.prepare(`
    SELECT t.id, t.status, t.user_a_id, t.user_b_id, t.a_coin, t.b_coin, t.created_at, t.completed_at,
           ua.username AS a_name, ub.username AS b_name
    FROM trades t JOIN users ua ON ua.id = t.user_a_id JOIN users ub ON ub.id = t.user_b_id
    WHERE ((t.user_a_id = ? AND t.a_hidden = 0) OR (t.user_b_id = ? AND t.b_hidden = 0)) AND t.status != 'PENDING'
    ORDER BY t.id DESC LIMIT ?
  `).all(userId, userId, lim);
  if (!rows.length) return [];
  const marks = rows.map(() => '?').join(',');
  const items = await db.prepare(`SELECT trade_id, user_id, gift_name FROM trade_items WHERE trade_id IN (${marks})`).all(...rows.map(r => r.id));
  return rows.map(r => {
    const iAmA = r.user_a_id === userId;
    const mine = items.filter(i => i.trade_id === r.id && i.user_id === userId).map(i => i.gift_name);
    const theirs = items.filter(i => i.trade_id === r.id && i.user_id !== userId).map(i => i.gift_name);
    return {
      id: r.id, status: r.status, with: iAmA ? r.b_name : r.a_name,
      my_coin: iAmA ? r.a_coin : r.b_coin, their_coin: iAmA ? r.b_coin : r.a_coin,
      my_gifts: mine, their_gifts: theirs, created_at: r.created_at, completed_at: r.completed_at,
    };
  });
}

// ---------- Tarixni o'chirish (faqat o'zining ko'rinishidan) ----------
// Trade yozuvi bazada qoladi: sherik tarixi va admin audit loglari saqlanadi. Faol (PENDING/ACTIVE) trade o'chirilmaydi.
const FINISHED = ['REJECTED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'FAILED'];

async function deleteFromHistory(userId, tradeId) {
  return tradeTx(async (tx) => {
    const { t, side } = await loadForUser(tx, tradeId, userId);
    if (!FINISHED.includes(t.status)) {
      throw new TradeError(409, "Faol Trade'ni tarixdan o'chirib bo'lmaydi. Avval uni yakunlang yoki bekor qiling.", { code: 'NOT_FINISHED' });
    }
    await tx.prepare(`UPDATE trades SET ${side}_hidden = 1 WHERE id = ?`).run(t.id);
    await log(tx, t.id, userId, 'history_hidden', null);
    return { ok: true };
  });
}

async function clearHistory(userId) {
  return tradeTx(async (tx) => {
    const marks = FINISHED.map(() => '?').join(',');
    const a = await tx.prepare(`UPDATE trades SET a_hidden = 1 WHERE user_a_id = ? AND a_hidden = 0 AND status IN (${marks})`).run(userId, ...FINISHED);
    const b = await tx.prepare(`UPDATE trades SET b_hidden = 1 WHERE user_b_id = ? AND b_hidden = 0 AND status IN (${marks})`).run(userId, ...FINISHED);
    await log(tx, null, userId, 'history_cleared', `count=${a.changes + b.changes}`);
    return { ok: true, count: a.changes + b.changes };
  });
}

// ---------- Admin (faqat ko'rish) ----------

async function adminList(filters) {
  const f = filters || {};
  const where = [];
  const args = [];
  if (f.status && STATUSES.includes(String(f.status).toUpperCase())) {
    where.push('t.status = ?'); args.push(String(f.status).toUpperCase());
  }
  if (f.q) {
    const q = String(f.q).trim().replace(/^#/, '').slice(0, 64);
    if (/^\d+$/.test(q)) {
      where.push('(t.id = ? OR ua.username LIKE ? OR ub.username LIKE ?)'); args.push(Number(q), `%${q}%`, `%${q}%`);
    } else if (q) {
      where.push('(ua.username LIKE ? OR ub.username LIKE ?)'); args.push(`%${q}%`, `%${q}%`);
    }
  }
  const fromD = f.from ? new Date(f.from) : null;
  const toD = f.to ? new Date(f.to) : null;
  if (fromD && !isNaN(fromD)) { where.push('t.created_at >= ?'); args.push(fromD.toISOString()); }
  if (toD && !isNaN(toD)) { toD.setHours(23, 59, 59, 999); where.push('t.created_at <= ?'); args.push(toD.toISOString()); }

  const rows = await db.prepare(`
    SELECT t.*, ua.username AS a_name, ub.username AS b_name
    FROM trades t JOIN users ua ON ua.id = t.user_a_id JOIN users ub ON ub.id = t.user_b_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.id DESC LIMIT 200
  `).all(...args);
  return rows;
}

async function adminDetail(tradeId) {
  const id = parseId(tradeId);
  if (!id) throw new TradeError(404, 'Trade topilmadi');
  const t = await db.prepare(`
    SELECT t.*, ua.username AS a_name, ub.username AS b_name
    FROM trades t JOIN users ua ON ua.id = t.user_a_id JOIN users ub ON ub.id = t.user_b_id WHERE t.id = ?
  `).get(id);
  if (!t) throw new TradeError(404, 'Trade topilmadi');
  const items = await db.prepare('SELECT user_id, user_gift_id, gift_id, gift_name FROM trade_items WHERE trade_id = ? ORDER BY id').all(id);
  const logs = await db.prepare(`
    SELECT l.id, l.action, l.user_id, l.details, l.created_at, u.username
    FROM trade_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.trade_id = ? ORDER BY l.id ASC
  `).all(id);
  return { trade: t, items, logs };
}

// Admin chatni moderatsiya uchun ochsa — audit logga yoziladi
async function adminOpenChat(adminId, tradeId) {
  const id = parseId(tradeId);
  if (!id) throw new TradeError(404, 'Trade topilmadi');
  const t = await db.prepare('SELECT id FROM trades WHERE id = ?').get(id);
  if (!t) throw new TradeError(404, 'Trade topilmadi');
  await tradeTx(async (tx) => { await log(tx, id, adminId, 'admin_chat_viewed', null); });
  return db.prepare(`
    SELECT m.id, m.user_id, m.body, m.created_at, u.username
    FROM trade_messages m JOIN users u ON u.id = m.user_id WHERE m.trade_id = ? ORDER BY m.id ASC LIMIT 500
  `).all(id);
}

// ---------- Tozalash ----------

// Admin foydalanuvchini o'chirmoqchi bo'lsa: uning trade'lari bekor qilinadi (sherikka hamma narsa qaytadi), keyin yozuvlar o'chiriladi
async function purgeUserTrades(userId) {
  await tradeTx(async (tx, after) => {
    const active = await tx.prepare("SELECT * FROM trades WHERE status = 'ACTIVE' AND (user_a_id = ? OR user_b_id = ?)").all(userId, userId);
    for (const t of active) {
      await releaseAndClose(tx, after, t, 'CANCELLED', 'user_deleted', null);
      const oid = t.user_a_id === userId ? t.user_b_id : t.user_a_id;
      await notify(tx, after, oid, t.id, 'cancelled', `Trade #${t.id} bekor qilindi: foydalanuvchi o'chirildi.`);
    }
    const all = await tx.prepare('SELECT id FROM trades WHERE user_a_id = ? OR user_b_id = ?').all(userId, userId);
    for (const t of all) {
      await tx.prepare('DELETE FROM trade_items WHERE trade_id = ?').run(t.id);
      await tx.prepare('DELETE FROM trade_messages WHERE trade_id = ?').run(t.id);
      await tx.prepare('DELETE FROM trade_notifications WHERE trade_id = ?').run(t.id);
      await tx.prepare('DELETE FROM trade_active_users WHERE trade_id = ?').run(t.id);
      await tx.prepare('UPDATE transfers SET trade_id = NULL WHERE trade_id = ?').run(t.id);
      await tx.prepare('DELETE FROM trades WHERE id = ?').run(t.id);
    }
    await tx.prepare('DELETE FROM trade_notifications WHERE user_id = ?').run(userId);
    await tx.prepare('DELETE FROM trade_logs WHERE user_id = ?').run(userId);
  });
}

// Bloklangan foydalanuvchining ACTIVE trade'i qolib ketmasligi uchun
async function reapBlocked() {
  const rows = await db.prepare(`
    SELECT t.id FROM trades t
    JOIN users ua ON ua.id = t.user_a_id JOIN users ub ON ub.id = t.user_b_id
    WHERE t.status = 'ACTIVE' AND (ua.is_blocked = 1 OR ub.is_blocked = 1)
  `).all();
  for (const r of rows) {
    await tradeTx(async (tx, after) => {
      const t = await tx.prepare('SELECT * FROM trades WHERE id = ?').get(r.id);
      if (!t) return;
      if (await releaseAndClose(tx, after, t, 'CANCELLED', 'user_blocked', null)) {
        for (const uid of [t.user_a_id, t.user_b_id]) {
          await notify(tx, after, uid, t.id, 'cancelled', `Trade #${t.id} bekor qilindi: ishtirokchi bloklangan.`);
        }
      }
    }).catch(e => console.error('reapBlocked xatosi:', e.message));
  }
}

let timer = null;
function startScheduler() {
  if (timer) return;
  const tick = () => {
    sweepExpired().catch(e => console.error('Trade expire xatosi:', e.message));
    reapBlocked().catch(e => console.error('Trade reap xatosi:', e.message));
  };
  tick();
  timer = setInterval(tick, 30 * 1000);
}

module.exports = {
  TradeError, STATUSES,
  createRequest, acceptRequest, declineRequest, cancelTrade,
  addGift, removeGift, setCoin, lockOffer, unlockOffer, confirmTrade,
  postMessage, viewTrade, availableGifts, summary, markNotificationsSeen, history, deleteFromHistory, clearHistory,
  adminList, adminDetail, adminOpenChat, purgeUserTrades, sweepExpired, startScheduler,
};
