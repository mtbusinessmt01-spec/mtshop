const express = require('express');
const { upload, fileToDataUrl } = require('../imageUpload');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

// ---------- ADMIN: Gift CRUD ----------

// Barcha giftlarni ko'rish (admin uchun, qolgan soni bilan)
router.get('/admin/gifts', authMiddleware, adminMiddleware, async (req, res) => {
  const gifts = await db.prepare('SELECT * FROM gifts ORDER BY created_at DESC').all();
  res.json(gifts);
});

// Yangi gift yaratish
router.post('/admin/gifts', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name, price, quantity, unlimited } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nomi va narxi kerak' });

  const imageUrl = fileToDataUrl(req.file);
  const qty = unlimited === 'true' || unlimited === true ? null : parseInt(quantity, 10) || 0;

  const result = await db.prepare(
    'INSERT INTO gifts (name, image_url, price, quantity) VALUES (?, ?, ?, ?)'
  ).run(name, imageUrl, parseFloat(price), qty);

  res.json(await db.prepare('SELECT * FROM gifts WHERE id = ?').get(result.lastInsertRowid));
});

// Giftni tahrirlash
router.put('/admin/gifts/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });

  const { name, price, quantity, unlimited } = req.body;
  const imageUrl = req.file ? fileToDataUrl(req.file) : gift.image_url;
  const qty = unlimited === 'true' || unlimited === true
    ? null
    : (quantity !== undefined ? parseInt(quantity, 10) : gift.quantity);

  await db.prepare(
    'UPDATE gifts SET name = ?, price = ?, quantity = ?, image_url = ? WHERE id = ?'
  ).run(name || gift.name, price ? parseFloat(price) : gift.price, qty, imageUrl, id);

  res.json(await db.prepare('SELECT * FROM gifts WHERE id = ?').get(id));
});

// Giftni o'chirish
router.delete('/admin/gifts/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await db.prepare('DELETE FROM gifts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: Shop, Inventory, Buy, Sell ----------

// Shop: sotib olsa bo'ladigan giftlar (soni 0 bo'lmaganlar)
router.get('/gifts', authMiddleware, async (req, res) => {
  const gifts = await db.prepare(
    'SELECT * FROM gifts WHERE quantity IS NULL OR quantity > 0 ORDER BY price ASC'
  ).all();
  res.json(gifts);
});

// Sotib olish
router.post('/gifts/:id/buy', authMiddleware, async (req, res) => {
  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });

  const qty = Math.max(1, parseInt(req.body?.quantity, 10) || 1);
  const totalPrice = Math.round(gift.price * qty * 100) / 100;

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
    'INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)'
  );
  for (let i = 0; i < qty; i++) await insertOne.run(req.user.id, gift.id, gift.price);

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance, bought_qty: qty });
});

// Inventar: mening giftlarim
router.get('/inventory/gifts', authMiddleware, async (req, res) => {
  const items = await db.prepare(`
    SELECT ug.id as inventory_id, ug.bought_price, ug.acquired_at,
           g.id as gift_id, g.name, g.image_url, g.price as current_price
    FROM user_gifts ug
    JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ?
    ORDER BY ug.acquired_at DESC
  `).all(req.user.id);
  res.json(items);
});

// Orqaga sotish: joriy narxning 80%
router.post('/inventory/gifts/:inventoryId/sell', authMiddleware, async (req, res) => {
  const item = await db.prepare(`
    SELECT ug.*, g.price as current_price
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.id = ? AND ug.user_id = ?
  `).get(req.params.inventoryId, req.user.id);

  if (!item) return res.status(404).json({ error: 'Topilmadi' });

  const sellPrice = Math.round(item.current_price * 0.8 * 100) / 100;

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM user_gifts WHERE id = ?').run(item.id);
    await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?')
      .run(sellPrice, req.user.id);
  });
  await tx();

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, sold_for: sellPrice, coin_balance: updatedUser.coin_balance });
});

module.exports = router;
