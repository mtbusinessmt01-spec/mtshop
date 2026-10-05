// Promokod tizimi: admin yaratadi (coin / gift / case), foydalanuvchi Profile orqali kiritadi.
// Pul/gift beradigan joy db.withTx ichida — xato bo'lsa hamma narsa ROLLBACK qilinadi.
const crypto = require('crypto');
const db = require('./db');

class PromoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const MAX_ITEMS = 10;       // bitta promokodda ko'pi bilan nechta xil gift/case
const MAX_QTY = 50;         // bitta gift/case dan ko'pi bilan nechta dona
const MAX_COIN = 1000000;

const normCode = (c) => String(c == null ? '' : c).trim().toUpperCase();

// ---------- Taxmin qilib topishdan himoya (har foydalanuvchiga 10 daqiqada 8 ta xato urinish) ----------
const fails = new Map(); // userId -> { n, resetAt }
const FAIL_LIMIT = 8;
const FAIL_WINDOW = 10 * 60 * 1000;

function checkLimit(userId) {
  const f = fails.get(userId);
  if (f && f.resetAt > Date.now() && f.n >= FAIL_LIMIT) {
    const min = Math.ceil((f.resetAt - Date.now()) / 60000);
    throw new PromoError(`Juda ko'p xato urinish. ${min} daqiqadan keyin qayta urinib ko'ring`, 429);
  }
}
function recordFail(userId) {
  const now = Date.now();
  const f = fails.get(userId);
  if (!f || f.resetAt <= now) fails.set(userId, { n: 1, resetAt: now + FAIL_WINDOW });
  else f.n += 1;
}

// ---------- FOYDALANUVCHI: kodni ishlatish ----------
async function redeem(userId, rawCode) {
  const code = normCode(rawCode);
  if (!code) throw new PromoError('Promokodni kiriting');
  checkLimit(userId);

  let out;
  try {
    out = await db.withTx(async (tx) => {
      const user = await tx.prepare('SELECT id, is_blocked FROM users WHERE id = ?').get(userId);
      if (!user) throw new PromoError('Foydalanuvchi topilmadi', 404);
      if (user.is_blocked) throw new PromoError('Hisobingiz bloklangan', 403);

      const promo = await tx.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
      if (!promo) throw new PromoError('Bunday promokod topilmadi', 404);
      if (!promo.is_active) throw new PromoError('Bu promokod hozir faol emas', 404);
      if (promo.expires_at && Date.parse(promo.expires_at) <= Date.now()) {
        throw new PromoError('Bu promokodning muddati tugagan', 404);
      }
      if (promo.max_uses != null && promo.used_count >= promo.max_uses) {
        throw new PromoError('Bu promokodning limiti tugagan', 404);
      }
      const already = await tx.prepare(
        'SELECT id FROM promo_redemptions WHERE promo_id = ? AND user_id = ?'
      ).get(promo.id, userId);
      if (already) throw new PromoError('Siz bu promokodni allaqachon ishlatgansiz', 409);

      const items = await tx.prepare('SELECT * FROM promo_code_items WHERE promo_id = ? ORDER BY id').all(promo.id);

      // Avval hamma mukofot mavjudligini tekshiramiz (gift/case o'chirilgan bo'lishi mumkin)
      const resolved = [];
      for (const it of items) {
        if (it.item_type === 'gift') {
          const g = await tx.prepare('SELECT id, name, price FROM gifts WHERE id = ?').get(it.gift_id);
          if (!g) throw new PromoError("Promokod mukofotidagi gift topilmadi. Admin bilan bog'laning", 409);
          resolved.push({ ...it, gift: g });
        } else {
          const c = await tx.prepare('SELECT id, name FROM cases WHERE id = ?').get(it.case_id);
          if (!c) throw new PromoError("Promokod mukofotidagi case topilmadi. Admin bilan bog'laning", 409);
          resolved.push({ ...it, case: c });
        }
      }

      // Limitni atomik band qilamiz (parallel so'rovlar limitdan oshirib yubormasin)
      const upd = await tx.prepare(
        'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)'
      ).run(promo.id);
      if (!upd.changes) throw new PromoError('Bu promokodning limiti tugagan', 404);

      await tx.prepare('INSERT INTO promo_redemptions (promo_id, user_id) VALUES (?, ?)').run(promo.id, userId);

      const rewards = [];
      if (promo.coin_amount > 0) {
        await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(promo.coin_amount, userId);
        rewards.push({ type: 'coin', amount: promo.coin_amount });
      }
      for (const it of resolved) {
        if (it.item_type === 'gift') {
          for (let i = 0; i < it.quantity; i++) {
            await tx.prepare('INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)')
              .run(userId, it.gift.id, it.gift.price);
          }
          rewards.push({ type: 'gift', name: it.gift.name, quantity: it.quantity, gift_id: it.gift.id });
        } else {
          for (let i = 0; i < it.quantity; i++) {
            await tx.prepare('INSERT INTO user_cases (user_id, case_id) VALUES (?, ?)').run(userId, it.case.id);
          }
          rewards.push({ type: 'case', name: it.case.name, quantity: it.quantity, case_id: it.case.id });
        }
      }

      const bal = await tx.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
      return { rewards, coin_balance: bal.coin_balance };
    });
  } catch (e) {
    if (e instanceof PromoError && e.status === 404) recordFail(userId);
    throw e;
  }
  return out;
}

// ---------- ADMIN ----------
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // chalkashtiradigan harflarsiz
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

async function listPromos() {
  const promos = await db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all();
  const items = await db.prepare(`
    SELECT pi.*, g.name AS gift_name, c.name AS case_name
    FROM promo_code_items pi
    LEFT JOIN gifts g ON g.id = pi.gift_id
    LEFT JOIN cases c ON c.id = pi.case_id
    ORDER BY pi.id
  `).all();
  return promos.map(p => ({ ...p, items: items.filter(i => i.promo_id === p.id) }));
}

async function createPromo(body) {
  const b = body || {};
  let code = normCode(b.code);
  if (!code) code = randomCode();
  if (!CODE_RE.test(code)) {
    throw new PromoError("Kod 3-32 ta belgidan iborat bo'lishi kerak (faqat A-Z, 0-9, - va _)");
  }

  const coin = b.coin_amount === '' || b.coin_amount == null ? 0 : Number(b.coin_amount);
  if (!Number.isFinite(coin) || coin < 0 || coin > MAX_COIN) throw new PromoError("Coin miqdori noto'g'ri");

  let maxUses = null;
  if (b.max_uses !== '' && b.max_uses != null) {
    maxUses = Number(b.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new PromoError("Limit 1 yoki undan katta butun son bo'lishi kerak");
  }

  let expiresAt = null;
  if (b.expires_at) {
    const t = Date.parse(b.expires_at);
    if (isNaN(t)) throw new PromoError("Muddat noto'g'ri");
    if (t <= Date.now()) throw new PromoError("Muddat kelajakda bo'lishi kerak");
    expiresAt = new Date(t).toISOString();
  }

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > MAX_ITEMS) throw new PromoError(`Ko'pi bilan ${MAX_ITEMS} ta gift/case qo'shish mumkin`);
  const items = rawItems.map(it => {
    const type = it && it.item_type;
    const qty = Number(it && it.quantity);
    const id = Number(it && it.item_id);
    if (type !== 'gift' && type !== 'case') throw new PromoError("Mukofot turi noto'g'ri");
    if (!Number.isInteger(id) || id < 1) throw new PromoError('Gift/case tanlanmagan');
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new PromoError(`Miqdor 1 dan ${MAX_QTY} gacha bo'lishi kerak`);
    return { type, id, qty };
  });

  if (coin <= 0 && !items.length) throw new PromoError("Kamida bitta mukofot kerak: coin, gift yoki case");

  return db.withTx(async (tx) => {
    const exists = await tx.prepare('SELECT id FROM promo_codes WHERE code = ?').get(code);
    if (exists) throw new PromoError('Bu kod allaqachon mavjud', 409);

    for (const it of items) {
      const row = it.type === 'gift'
        ? await tx.prepare('SELECT id FROM gifts WHERE id = ?').get(it.id)
        : await tx.prepare('SELECT id FROM cases WHERE id = ?').get(it.id);
      if (!row) throw new PromoError(`${it.type === 'gift' ? 'Gift' : 'Case'} topilmadi`, 404);
    }

    const r = await tx.prepare(
      'INSERT INTO promo_codes (code, coin_amount, max_uses, expires_at) VALUES (?, ?, ?, ?)'
    ).run(code, coin, maxUses, expiresAt);
    for (const it of items) {
      await tx.prepare(
        'INSERT INTO promo_code_items (promo_id, item_type, gift_id, case_id, quantity) VALUES (?, ?, ?, ?, ?)'
      ).run(r.lastInsertRowid, it.type, it.type === 'gift' ? it.id : null, it.type === 'case' ? it.id : null, it.qty);
    }
    return { id: r.lastInsertRowid, code };
  });
}

async function setActive(id, active) {
  const r = await db.prepare('UPDATE promo_codes SET is_active = ? WHERE id = ?').run(active ? 1 : 0, Number(id));
  if (!r.changes) throw new PromoError('Promokod topilmadi', 404);
  return { ok: true };
}

async function removePromo(id) {
  const pid = Number(id);
  return db.withTx(async (tx) => {
    const p = await tx.prepare('SELECT id FROM promo_codes WHERE id = ?').get(pid);
    if (!p) throw new PromoError('Promokod topilmadi', 404);
    await tx.prepare('DELETE FROM promo_redemptions WHERE promo_id = ?').run(pid);
    await tx.prepare('DELETE FROM promo_code_items WHERE promo_id = ?').run(pid);
    await tx.prepare('DELETE FROM promo_codes WHERE id = ?').run(pid);
    return { ok: true };
  });
}

async function redemptions(id) {
  return db.prepare(`
    SELECT r.id, r.created_at, u.username
    FROM promo_redemptions r JOIN users u ON u.id = r.user_id
    WHERE r.promo_id = ? ORDER BY r.id DESC LIMIT 200
  `).all(Number(id));
}

module.exports = { PromoError, redeem, listPromos, createPromo, setActive, removePromo, redemptions };
