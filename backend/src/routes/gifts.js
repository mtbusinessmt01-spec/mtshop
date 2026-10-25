const express = require('express');
const { upload, fileToDataUrl } = require('../imageUpload');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { requirePin } = require('../security');
const { isEventItemLocked, parseEventId, eventRibbon } = require('../eventUtil');

const router = express.Router();

const RARITIES = ['common', 'rare', 'legendary'];
function cleanRarity(r, fallback = 'common') {
  return RARITIES.includes(r) ? r : fallback;
}

// ---------- ADMIN: Gift CRUD ----------

// Barcha giftlarni ko'rish (admin uchun, qolgan soni bilan)
router.get('/admin/gifts', authMiddleware, adminMiddleware, async (req, res) => {
  const gifts = await db.prepare('SELECT * FROM gifts ORDER BY created_at DESC').all();
  res.json(gifts);
});

// Yangi gift yaratish
router.post('/admin/gifts', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name, price, quantity, unlimited, rarity } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nomi va narxi kerak' });

  const imageUrl = fileToDataUrl(req.file);
  const qty = unlimited === 'true' || unlimited === true ? null : parseInt(quantity, 10) || 0;

  let eventId = await parseEventId(req.body.event_id);
  if (eventId === undefined) eventId = null;

  const result = await db.prepare(
    'INSERT INTO gifts (name, image_url, price, quantity, rarity, event_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, imageUrl, parseFloat(price), qty, cleanRarity(rarity), eventId);

  res.json(await db.prepare('SELECT * FROM gifts WHERE id = ?').get(result.lastInsertRowid));
});

// Giftni tahrirlash
router.put('/admin/gifts/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });

  const { name, price, quantity, unlimited, rarity } = req.body;
  const imageUrl = req.file ? fileToDataUrl(req.file) : gift.image_url;
  const qty = unlimited === 'true' || unlimited === true
    ? null
    : (quantity !== undefined ? parseInt(quantity, 10) : gift.quantity);

  let eventId = await parseEventId(req.body.event_id);
  if (eventId === undefined) eventId = gift.event_id ?? null;

  await db.prepare(
    'UPDATE gifts SET name = ?, price = ?, quantity = ?, image_url = ?, rarity = ?, event_id = ? WHERE id = ?'
  ).run(name || gift.name, price ? parseFloat(price) : gift.price, qty, imageUrl, cleanRarity(rarity, gift.rarity || 'common'), eventId, id);

  res.json(await db.prepare('SELECT * FROM gifts WHERE id = ?').get(id));
});

// Giftni o'chirish
router.delete('/admin/gifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const tx = db.transaction(async () => {
    // Foydalanuvchilar inventaridagi shu giftni ham tozalaymiz
    await db.prepare('DELETE FROM user_gifts WHERE gift_id = ?').run(req.params.id);
    // Case'lar ichidagi shu giftga ishora qiluvchi narsalarni olib tashlaymiz
    await db.prepare('DELETE FROM case_items WHERE gift_id = ?').run(req.params.id);
    // Transfer tarixida bu giftga bo'lgan bog'lanishni yo'qotamiz (tarix o'zi qoladi)
    await db.prepare('UPDATE transfers SET gift_id = NULL WHERE gift_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM gift_variants WHERE gift_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM gifts WHERE id = ?').run(req.params.id);
  });
  await tx();
  res.json({ ok: true });
});

// ---------- ADMIN: Gift turlari (nomi, narxi, rasmi bilan farq qiladi) ----------

function parseVariantFields(body) {
  const name = String(body.name || '').trim().slice(0, 60);
  const price = parseFloat(body.price);
  if (!name) return { error: 'Tur nomi kerak' };
  if (isNaN(price) || price < 0) return { error: "Narx to'g'ri kiritilishi kerak" };
  return { name, price: Math.round(price * 100) / 100 };
}

// Tanlangan giftning barcha turlari
router.get('/admin/gifts/:id/variants', authMiddleware, adminMiddleware, async (req, res) => {
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });
  const variants = await db.prepare('SELECT * FROM gift_variants WHERE gift_id = ? ORDER BY id ASC').all(gift.id);
  res.json({ gift, variants });
});

// Yangi tur qo'shish
router.post('/admin/gifts/:id/variants', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });
  const f = parseVariantFields(req.body || {});
  if (f.error) return res.status(400).json({ error: f.error });

  const result = await db.prepare(
    'INSERT INTO gift_variants (gift_id, name, price, image_url) VALUES (?, ?, ?, ?)'
  ).run(gift.id, f.name, f.price, fileToDataUrl(req.file));
  res.json(await db.prepare('SELECT * FROM gift_variants WHERE id = ?').get(result.lastInsertRowid));
});

// Turni tahrirlash (rasm yuborilmasa eskisi qoladi)
router.put('/admin/gift-variants/:variantId', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const v = await db.prepare('SELECT * FROM gift_variants WHERE id = ?').get(req.params.variantId);
  if (!v) return res.status(404).json({ error: 'Tur topilmadi' });
  const f = parseVariantFields(req.body || {});
  if (f.error) return res.status(400).json({ error: f.error });

  const imageUrl = req.file ? fileToDataUrl(req.file) : v.image_url;
  await db.prepare('UPDATE gift_variants SET name = ?, price = ?, image_url = ? WHERE id = ?')
    .run(f.name, f.price, imageUrl, v.id);
  res.json(await db.prepare('SELECT * FROM gift_variants WHERE id = ?').get(v.id));
});

// Turni o'chirish: bu turni olgan foydalanuvchilarda gift asosiy gift ko'rinishida qoladi
router.delete('/admin/gift-variants/:variantId', authMiddleware, adminMiddleware, async (req, res) => {
  const v = await db.prepare('SELECT * FROM gift_variants WHERE id = ?').get(req.params.variantId);
  if (!v) return res.status(404).json({ error: 'Tur topilmadi' });
  await db.transaction(async () => {
    await db.prepare('UPDATE user_gifts SET variant_id = NULL WHERE variant_id = ?').run(v.id);
    await db.prepare('DELETE FROM gift_variants WHERE id = ?').run(v.id);
  })();
  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: Shop, Inventory, Buy, Sell ----------

// Shop: barcha giftlar. Soni tugaganlar ham chiqadi (sold_out: true, "Qolmagan" lentasi bilan) — ular ro'yxat oxirida.
router.get('/gifts', authMiddleware, async (req, res) => {
  const nowIso = new Date().toISOString();
  // Event'i hali boshlanmagan giftlar Shopda ko'rinmaydi
  const rows = await db.prepare(`
    SELECT g.*, e.name AS event_name, e.ribbon_color AS event_ribbon_color,
           e.starts_at AS event_starts_at, e.ends_at AS event_ends_at
    FROM gifts g
    LEFT JOIN events e ON e.id = g.event_id
    WHERE (g.event_id IS NULL OR e.id IS NULL OR e.starts_at <= ?)
    ORDER BY CASE WHEN g.quantity IS NOT NULL AND g.quantity <= 0 THEN 1 ELSE 0 END, g.price ASC
  `).all(nowIso);
  // Event davom etayotgan bo'lsagina lenta chiqadi; tugagach gift oddiy gift bo'lib qoladi
  const gifts = rows.map(r => {
    const { event_name, event_ribbon_color, event_starts_at, event_ends_at, ...g } = r;
    return {
      ...g,
      sold_out: g.quantity !== null && g.quantity <= 0,
      event_ribbon: eventRibbon(r, nowIso),
    };
  });

  // Har bir giftga uning turlarini biriktiramiz
  const variantsByGift = {};
  if (gifts.length) {
    const ids = gifts.map(g => g.id);
    const vs = await db.prepare(
      `SELECT id, gift_id, name, price, image_url FROM gift_variants WHERE gift_id IN (${ids.map(() => '?').join(',')}) ORDER BY price ASC, id ASC`
    ).all(...ids);
    for (const v of vs) (variantsByGift[v.gift_id] = variantsByGift[v.gift_id] || []).push(v);
  }
  res.json(gifts.map(g => ({ ...g, variants: variantsByGift[g.id] || [] })));
});

// Sotib olish
router.post('/gifts/:id/buy', authMiddleware, async (req, res) => {
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });
  if (await isEventItemLocked(gift.event_id)) {
    return res.status(400).json({ error: 'Bu gift event boshlangandan keyin sotuvga chiqadi' });
  }

  const qty = Math.max(1, parseInt(req.body?.quantity, 10) || 1);

  // Tur tanlangan bo'lsa narx shu turdan olinadi (soni esa asosiy gift bilan umumiy)
  let variant = null;
  const variantId = parseInt(req.body?.variant_id, 10);
  if (variantId) {
    variant = await db.prepare('SELECT * FROM gift_variants WHERE id = ? AND gift_id = ?').get(variantId, gift.id);
    if (!variant) return res.status(404).json({ error: 'Gift turi topilmadi' });
  }
  const unitPrice = variant ? variant.price : gift.price;
  const totalPrice = Math.round(unitPrice * qty * 100) / 100;

  // Avval sonini (agar cheklangan bo'lsa) atomik ravishda kamaytiramiz
  if (gift.quantity !== null) {
    const stockResult = await db.prepare(
      'UPDATE gifts SET quantity = quantity - ? WHERE id = ? AND quantity >= ?'
    ).run(qty, gift.id, qty);
    if (!stockResult.changes) {
      return res.status(400).json({ error: `Yetarli dona qolmagan` });
    }
  }

  // Keyin balansni atomik ravishda yechamiz
  const deductResult = await db.prepare(
    'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
  ).run(totalPrice, req.user.id, totalPrice);

  if (!deductResult.changes) {
    // Balans yetmadi — sonini orqaga qaytaramiz
    if (gift.quantity !== null) {
      await db.prepare('UPDATE gifts SET quantity = quantity + ? WHERE id = ?').run(qty, gift.id);
    }
    return res.status(400).json({ error: 'Coin yetarli emas' });
  }

  const insertOne = db.prepare(
    'INSERT INTO user_gifts (user_id, gift_id, bought_price, variant_id) VALUES (?, ?, ?, ?)'
  );
  for (let i = 0; i < qty; i++) await insertOne.run(req.user.id, gift.id, unitPrice, variant ? variant.id : null);

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance, bought_qty: qty });
});

// Inventar: mening giftlarim
router.get('/inventory/gifts', authMiddleware, async (req, res) => {
  const items = await db.prepare(`
    SELECT ug.id as inventory_id, ug.bought_price, ug.acquired_at, ug.trade_id, ug.variant_id,
           g.id as gift_id,
           COALESCE(v.name, g.name) as name,
           COALESCE(v.image_url, g.image_url) as image_url,
           COALESCE(v.price, g.price) as current_price
    FROM user_gifts ug
    JOIN gifts g ON g.id = ug.gift_id
    LEFT JOIN gift_variants v ON v.id = ug.variant_id
    WHERE ug.user_id = ?
    ORDER BY ug.acquired_at DESC
  `).all(req.user.id);
  res.json(items);
});

// Orqaga sotish: joriy narxning 80%
router.post('/inventory/gifts/:inventoryId/sell', authMiddleware, requirePin, async (req, res) => {
  const item = await db.prepare(`
    SELECT ug.*, COALESCE(v.price, g.price) as current_price
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    LEFT JOIN gift_variants v ON v.id = ug.variant_id
    WHERE ug.id = ? AND ug.user_id = ?
  `).get(req.params.inventoryId, req.user.id);

  if (!item) return res.status(404).json({ error: 'Topilmadi' });
  if (item.trade_id) return res.status(409).json({ error: "Bu gift Trade'da band — sotib bo'lmaydi" });

  const sellPrice = Math.round(item.current_price * 0.8 * 100) / 100;

  // Haqiqiy tranzaksiya: gift faqat egasida va Trade'da band bo'lmasa o'chiriladi; faqat shunda coin beriladi
  // (parallel ikki marta sotish yoki sotish + Trade poygasi mumkin emas)
  try {
    await db.withTx(async (tx) => {
      const del = await tx.prepare('DELETE FROM user_gifts WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(item.id, req.user.id);
      if (!del.changes) throw new Error('GIFT_UNAVAILABLE');
      await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(sellPrice, req.user.id);
    });
  } catch (e) {
    if (e.message === 'GIFT_UNAVAILABLE') return res.status(409).json({ error: "Bu giftni sotib bo'lmaydi (allaqachon sotilgan yoki Trade'da band)" });
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, sold_for: sellPrice, coin_balance: updatedUser.coin_balance });
});

module.exports = router;
