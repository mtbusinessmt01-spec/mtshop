// Profil: emoji status (username yonidagi kichik gift rasmi) va profilga qadalgan giftlar (📌)
//
// Qoidalar (hammasi serverda tekshiriladi):
//  * Emoji status: narxi EMOJI_MIN_PRICE ga TENG yoki undan yuqori (>=) gift. Foydalanuvchida shu gift kamida 1 ta bo'lishi kerak.
//  * Qadash: narxi PIN_MIN_PRICE ga TENG yoki undan YUQORI (>=) gift, ko'pi bilan PIN_MAX ta.
//  * Gift sotilsa / yuborilsa / trade'da ketsa yoki narxi pasaysa — belgi ko'rinishdan AVTOMATIK yo'qoladi
//    (har o'qishda egalik va narx qayta tekshiriladi, shuning uchun sotish/yuborish kodlariga tegilmaydi).

const db = require('./db');
const { AVATAR_MAX_BYTES, normalizeFullName, sniffImage } = require('./identityRules');

const EMOJI_MIN_PRICE = 200;
const PIN_MIN_PRICE = 100;
const PIN_MAX = 6;

class ProfileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseId(v) {
  const s = String(v == null ? '' : v);
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// Ko'rsatish uchun yaroqli emoji statuslar: { userId -> { gift_id, name } }
async function emojiMap(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT u.id AS user_id, g.id AS gift_id, g.name
    FROM users u JOIN gifts g ON g.id = u.emoji_gift_id
    WHERE u.id IN (${marks}) AND g.price >= ?
      AND EXISTS (SELECT 1 FROM user_gifts ug WHERE ug.user_id = u.id AND ug.gift_id = g.id)
  `).all(...ids, EMOJI_MIN_PRICE);
  rows.forEach(r => out.set(r.user_id, { gift_id: r.gift_id, name: r.name }));
  return out;
}

async function emojiFor(userId) {
  return (await emojiMap([userId])).get(userId) || null;
}

// Egasi o'zgargan (sotilgan / yuborilgan / trade'da ketgan) qadashlar o'chiriladi.
// Narxi vaqtincha pasaygan (admin o'zgartirgan) giftning qadash YOZUVI saqlanadi: u faqat ko'rinmay turadi
// va narx qaytganda yana chiqadi. Aks holda narxdagi vaqtinchalik o'zgarish foydalanuvchi qadashlarini butunlay o'chirib yuborardi.
async function cleanStalePins(userId) {
  await db.prepare(
    'DELETE FROM profile_pins WHERE user_id = ? AND user_gift_id NOT IN (SELECT id FROM user_gifts WHERE user_id = ?)'
  ).run(userId, userId);
}

async function pinsFor(userId) {
  await cleanStalePins(userId);
  // Yashirin (narxi pasaygan) yozuvlar qaytib chiqsa ham ko'pi bilan PIN_MAX ta ko'rsatiladi
  return db.prepare(`
    SELECT pp.user_gift_id, g.id AS gift_id, g.name, g.price
    FROM profile_pins pp
    JOIN user_gifts ug ON ug.id = pp.user_gift_id AND ug.user_id = pp.user_id
    JOIN gifts g ON g.id = ug.gift_id
    WHERE pp.user_id = ? AND g.price >= ?
    ORDER BY pp.position ASC, pp.id ASC
    LIMIT ?
  `).all(userId, PIN_MIN_PRICE, PIN_MAX);
}

// "Profile edit" ekrani uchun hamma ma'lumot
async function editData(userId) {
  const pins = await pinsFor(userId);
  const emoji = await emojiFor(userId);
  // Emoji statusni faqat giftning o'zi qolmaganda tozalaymiz; narx vaqtincha pasaysa tanlov saqlanadi (faqat ko'rinmaydi)
  await db.prepare(`
    UPDATE users SET emoji_gift_id = NULL
    WHERE id = ? AND emoji_gift_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM user_gifts ug WHERE ug.user_id = users.id AND ug.gift_id = users.emoji_gift_id)
  `).run(userId);

  const emojiOptions = await db.prepare(`
    SELECT g.id AS gift_id, g.name, g.price, COUNT(*) AS count
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ? AND g.price >= ?
    GROUP BY g.id ORDER BY g.price DESC, g.name ASC
  `).all(userId, EMOJI_MIN_PRICE);

  const pinOptions = await db.prepare(`
    SELECT ug.id AS user_gift_id, g.id AS gift_id, g.name, g.price
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ? AND g.price >= ?
      AND ug.id NOT IN (SELECT user_gift_id FROM profile_pins)
    ORDER BY g.price DESC, ug.id ASC
  `).all(userId, PIN_MIN_PRICE);

  return {
    limits: { emoji_min_price: EMOJI_MIN_PRICE, pin_min_price: PIN_MIN_PRICE, pin_max: PIN_MAX },
    emoji,
    emoji_options: emojiOptions,
    pins,
    pin_options: pinOptions,
  };
}

async function setEmoji(userId, giftId) {
  const gid = parseId(giftId);
  if (!gid) throw new ProfileError(400, "Gift noto'g'ri");
  const gift = await db.prepare('SELECT id, name, price FROM gifts WHERE id = ?').get(gid);
  if (!gift) throw new ProfileError(404, 'Gift topilmadi');
  if (!(gift.price >= EMOJI_MIN_PRICE)) {
    throw new ProfileError(400, `Emoji status uchun gift narxi ${EMOJI_MIN_PRICE} coin va undan yuqori bo'lishi kerak.`);
  }
  // Egalik va narxni UPDATE ichida atomik tekshiramiz (sotish bilan poyga bo'lmasligi uchun)
  const r = await db.prepare(`
    UPDATE users SET emoji_gift_id = ?
    WHERE id = ? AND EXISTS (
      SELECT 1 FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
      WHERE ug.user_id = ? AND ug.gift_id = ? AND g.price >= ?
    )
  `).run(gid, userId, userId, gid, EMOJI_MIN_PRICE);
  if (!r.changes) throw new ProfileError(403, 'Bu gift sizning inventaringizda yo\'q.');
  return { ok: true, emoji: { gift_id: gift.id, name: gift.name } };
}

async function clearEmoji(userId) {
  await db.prepare('UPDATE users SET emoji_gift_id = NULL WHERE id = ?').run(userId);
  return { ok: true };
}

async function pinGift(userId, userGiftId) {
  const ugId = parseId(userGiftId);
  if (!ugId) throw new ProfileError(400, "Gift noto'g'ri");
  await cleanStalePins(userId);
  return db.withTx(async (tx) => {
    const ug = await tx.prepare(
      'SELECT ug.id, ug.user_id, g.id AS gift_id, g.name, g.price FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id WHERE ug.id = ?'
    ).get(ugId);
    if (!ug || ug.user_id !== userId) throw new ProfileError(404, 'Gift sizning inventaringizda topilmadi.');
    if (!(ug.price >= PIN_MIN_PRICE)) throw new ProfileError(400, `Faqat narxi ${PIN_MIN_PRICE} coin va undan yuqori giftlarni qadash mumkin.`);

    const exists = await tx.prepare('SELECT id FROM profile_pins WHERE user_gift_id = ?').get(ugId);
    if (exists) throw new ProfileError(409, 'Bu gift allaqachon qadalgan.');

    // Limit faqat ko'rinadigan (egasi o'zi va narxi yetarli) qadashlar bo'yicha hisoblanadi
    const cnt = await tx.prepare(`
      SELECT COUNT(*) AS c FROM profile_pins pp
      JOIN user_gifts ug2 ON ug2.id = pp.user_gift_id AND ug2.user_id = pp.user_id
      JOIN gifts g2 ON g2.id = ug2.gift_id
      WHERE pp.user_id = ? AND g2.price >= ?
    `).get(userId, PIN_MIN_PRICE);
    if (cnt.c >= PIN_MAX) throw new ProfileError(400, `Ko'pi bilan ${PIN_MAX} ta gift qadash mumkin.`);

    const mx = await tx.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM profile_pins WHERE user_id = ?').get(userId);
    await tx.prepare('INSERT INTO profile_pins (user_id, user_gift_id, position) VALUES (?, ?, ?)').run(userId, ugId, mx.m + 1);
    return { ok: true, pin: { user_gift_id: ug.id, gift_id: ug.gift_id, name: ug.name } };
  });
}

async function unpinGift(userId, userGiftId) {
  const ugId = parseId(userGiftId);
  if (!ugId) throw new ProfileError(400, "Gift noto'g'ri");
  const r = await db.prepare('DELETE FROM profile_pins WHERE user_id = ? AND user_gift_id = ?').run(userId, ugId);
  if (!r.changes) throw new ProfileError(404, 'Qadalgan gift topilmadi.');
  return { ok: true };
}

// Qadalgan giftlar tartibi: yuborilgan ro'yxat tartibida birinchi bo'ladi, qolganlari (yashirinlar) oxirida qoladi
async function reorderPins(userId, ids) {
  if (!Array.isArray(ids) || ids.length > 50) throw new ProfileError(400, "Tartib noto'g'ri");
  const clean = [];
  for (const v of ids) {
    const n = parseId(v);
    if (!n) throw new ProfileError(400, "Tartib noto'g'ri");
    if (!clean.includes(n)) clean.push(n);
  }
  await db.withTx(async (tx) => {
    const mine = await tx.prepare('SELECT user_gift_id FROM profile_pins WHERE user_id = ?').all(userId);
    const mineSet = new Set(mine.map(r => r.user_gift_id));
    let pos = 1;
    for (const id of clean) {
      if (!mineSet.has(id)) continue;
      await tx.prepare('UPDATE profile_pins SET position = ? WHERE user_id = ? AND user_gift_id = ?').run(pos++, userId, id);
      mineSet.delete(id);
    }
    for (const id of mineSet) {
      await tx.prepare('UPDATE profile_pins SET position = ? WHERE user_id = ? AND user_gift_id = ?').run(pos++, userId, id);
    }
  });
  return { ok: true };
}

// ---------- Ism Familiya va profil rasmi (foydalanuvchi o'zi qo'yadi, admin kiritmaydi) ----------

// Rasm havolasi: ?v= — rasm almashganda brauzer keshi yangilanishi uchun
function avatarUrl(userId, ver) {
  return ver ? `/api/users/${Number(userId)}/avatar?v=${Number(ver)}` : null;
}

// SQL qatoridan ommaga beriladigan shaklga: avatar_ver -> avatar_url
function withAvatar(row) {
  if (!row) return row;
  const { avatar_ver, ...rest } = row;
  return { ...rest, avatar_url: avatarUrl(row.id, avatar_ver) };
}

async function setFullName(userId, raw) {
  const r = normalizeFullName(raw);
  if (!r.ok) throw new ProfileError(400, r.error);
  await db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(r.value, userId);
  return { ok: true, full_name: r.value };
}

async function setAvatar(userId, file) {
  if (!file || !file.buffer) throw new ProfileError(400, 'Rasm tanlanmadi');
  const mime = sniffImage(file.buffer);
  if (!mime) throw new ProfileError(400, 'Faqat JPG, PNG yoki WEBP rasm yuklash mumkin');
  if (file.buffer.length > AVATAR_MAX_BYTES) throw new ProfileError(400, 'Rasm hajmi katta (eng ko\'pi 250 KB)');
  const ver = Date.now();
  const dataUrl = `data:${mime};base64,${file.buffer.toString('base64')}`;
  await db.prepare('UPDATE users SET avatar_data = ?, avatar_ver = ? WHERE id = ?').run(dataUrl, ver, userId);
  return { ok: true, avatar_url: avatarUrl(userId, ver) };
}

async function clearAvatar(userId) {
  await db.prepare('UPDATE users SET avatar_data = NULL, avatar_ver = NULL WHERE id = ?').run(userId);
  return { ok: true, avatar_url: null };
}

// { mime, buffer } yoki null
async function avatarFile(userId) {
  const row = await db.prepare('SELECT avatar_data FROM users WHERE id = ?').get(userId);
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec((row && row.avatar_data) || '');
  return m ? { mime: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}

module.exports = {
  ProfileError, EMOJI_MIN_PRICE, PIN_MIN_PRICE, PIN_MAX,
  emojiMap, emojiFor, pinsFor, editData, setEmoji, clearEmoji, pinGift, unpinGift, reorderPins,
  avatarUrl, withAvatar, setFullName, setAvatar, clearAvatar, avatarFile,
};
