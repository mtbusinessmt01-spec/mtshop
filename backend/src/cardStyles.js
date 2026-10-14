// Pullik profil kartasi uslublari: admin yaratadi (nom, tur, ikki rang, narx), foydalanuvchi coin evaziga sotib oladi.
// Tanlangan uslub faqat foydalanuvchida shu uslub BO'LSA ko'rinadi (har o'qishda egalik tekshiriladi).

const db = require('./db');

const KINDS = ['solid', 'gradient', 'glow'];

class StyleError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseId(v) {
  const s = String(v == null ? '' : v);
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function cleanColor(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

function cleanPrice(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 10000000) return null;
  return Math.round(n * 100) / 100;
}

function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 30 ? s : null;
}

function publicStyle(r) {
  return r ? { id: r.id, name: r.name, kind: r.kind, color1: r.color1, color2: r.color2 } : null;
}

// Foydalanuvchining hozirgi (egalik tekshirilgan) uslubi yoki null
async function styleFor(userId) {
  const r = await db.prepare(`
    SELECT cs.id, cs.name, cs.kind, cs.color1, cs.color2
    FROM users u
    JOIN card_styles cs ON cs.id = u.card_style_id
    WHERE u.id = ? AND EXISTS (SELECT 1 FROM user_card_styles ucs WHERE ucs.user_id = u.id AND ucs.style_id = cs.id)
  `).get(userId);
  return publicStyle(r);
}

// Sotuvdagi uslublar + foydalanuvchida bor (o'chirilgan bo'lsa ham egasiga ko'rinadi)
async function listFor(userId) {
  const rows = await db.prepare(`
    SELECT cs.id, cs.name, cs.kind, cs.color1, cs.color2, cs.price, cs.is_active,
           CASE WHEN ucs.id IS NULL THEN 0 ELSE 1 END AS owned
    FROM card_styles cs
    LEFT JOIN user_card_styles ucs ON ucs.style_id = cs.id AND ucs.user_id = ?
    WHERE cs.is_active = 1 OR ucs.id IS NOT NULL
    ORDER BY cs.price ASC, cs.id ASC
  `).all(userId);
  const sel = await styleFor(userId);
  return { styles: rows.map(r => ({ ...publicStyle(r), price: r.price, owned: !!r.owned })), selected_id: sel ? sel.id : null };
}

async function buy(userId, styleId) {
  const sid = parseId(styleId);
  if (!sid) throw new StyleError(400, "Uslub noto'g'ri");
  return db.withTx(async (tx) => {
    const st = await tx.prepare('SELECT * FROM card_styles WHERE id = ? AND is_active = 1').get(sid);
    if (!st) throw new StyleError(404, 'Uslub topilmadi');
    const has = await tx.prepare('SELECT id FROM user_card_styles WHERE user_id = ? AND style_id = ?').get(userId, sid);
    if (has) throw new StyleError(400, 'Bu uslub sizda allaqachon bor');
    if (st.price > 0) {
      const r = await tx.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?').run(st.price, userId, st.price);
      if (!r.changes) throw new StyleError(400, 'Coin yetarli emas');
    }
    await tx.prepare('INSERT INTO user_card_styles (user_id, style_id, paid) VALUES (?, ?, ?)').run(userId, sid, st.price);
    const u = await tx.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
    return { ok: true, coin_balance: u.coin_balance, style: publicStyle(st) };
  });
}

async function select(userId, styleId) {
  if (styleId === null || styleId === undefined || styleId === '') {
    await db.prepare('UPDATE users SET card_style_id = NULL WHERE id = ?').run(userId);
    return { ok: true, style: null };
  }
  const sid = parseId(styleId);
  if (!sid) throw new StyleError(400, "Uslub noto'g'ri");
  const r = await db.prepare(`
    UPDATE users SET card_style_id = ?
    WHERE id = ? AND EXISTS (SELECT 1 FROM user_card_styles WHERE user_id = ? AND style_id = ?)
  `).run(sid, userId, userId, sid);
  if (!r.changes) throw new StyleError(403, 'Bu uslub sizda yo\'q. Avval sotib oling.');
  return { ok: true, style: await styleFor(userId) };
}

// ---------- ADMIN ----------
async function adminList() {
  const rows = await db.prepare(`
    SELECT cs.*, (SELECT COUNT(*) FROM user_card_styles ucs WHERE ucs.style_id = cs.id) AS owners
    FROM card_styles cs ORDER BY cs.id DESC
  `).all();
  return rows;
}

function readBody(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) { out.name = cleanName(b.name); if (!out.name) throw new StyleError(400, 'Nomi 1–30 belgi bo\'lishi kerak'); }
  if (!partial || b.kind !== undefined) { out.kind = KINDS.includes(b.kind) ? b.kind : null; if (!out.kind) throw new StyleError(400, 'Turi noto\'g\'ri'); }
  if (!partial || b.color1 !== undefined) { out.color1 = cleanColor(b.color1); if (!out.color1) throw new StyleError(400, 'Birinchi rang noto\'g\'ri'); }
  if (!partial || b.color2 !== undefined) { out.color2 = cleanColor(b.color2); if (!out.color2) throw new StyleError(400, 'Ikkinchi rang noto\'g\'ri'); }
  if (!partial || b.price !== undefined) { out.price = cleanPrice(b.price); if (out.price === null) throw new StyleError(400, 'Narx noto\'g\'ri'); }
  if (b.is_active !== undefined) out.is_active = (b.is_active === true || b.is_active === 1 || b.is_active === '1') ? 1 : 0;
  return out;
}

async function adminCreate(body) {
  const v = readBody(body || {}, false);
  const r = await db.prepare('INSERT INTO card_styles (name, kind, color1, color2, price, is_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.name, v.kind, v.color1, v.color2, v.price, v.is_active === undefined ? 1 : v.is_active);
  return db.prepare('SELECT * FROM card_styles WHERE id = ?').get(r.lastInsertRowid);
}

async function adminUpdate(id, body) {
  const sid = parseId(id);
  if (!sid) throw new StyleError(400, 'ID noto\'g\'ri');
  const old = await db.prepare('SELECT * FROM card_styles WHERE id = ?').get(sid);
  if (!old) throw new StyleError(404, 'Uslub topilmadi');
  const v = { ...old, ...readBody(body || {}, true) };
  await db.prepare('UPDATE card_styles SET name = ?, kind = ?, color1 = ?, color2 = ?, price = ?, is_active = ? WHERE id = ?')
    .run(v.name, v.kind, v.color1, v.color2, v.price, v.is_active, sid);
  return db.prepare('SELECT * FROM card_styles WHERE id = ?').get(sid);
}

// Hech kimda bo'lmasa — butunlay o'chiriladi; kimdadir bo'lsa — sotuvdan yashiriladi (egalari ishlatishda davom etadi)
async function adminDelete(id) {
  const sid = parseId(id);
  if (!sid) throw new StyleError(400, 'ID noto\'g\'ri');
  const st = await db.prepare('SELECT id FROM card_styles WHERE id = ?').get(sid);
  if (!st) throw new StyleError(404, 'Uslub topilmadi');
  const owners = await db.prepare('SELECT COUNT(*) AS c FROM user_card_styles WHERE style_id = ?').get(sid);
  if (owners.c > 0) {
    await db.prepare('UPDATE card_styles SET is_active = 0 WHERE id = ?').run(sid);
    return { ok: true, hidden: true };
  }
  await db.prepare('DELETE FROM card_styles WHERE id = ?').run(sid);
  return { ok: true, hidden: false };
}

module.exports = { StyleError, styleFor, listFor, buy, select, adminList, adminCreate, adminUpdate, adminDelete };
