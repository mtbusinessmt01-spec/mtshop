const express = require('express');
const db = require('./db');
const { authMiddleware, adminMiddleware } = require('./auth');
const { makeUploader } = require('./upload');

const router = express.Router();
const uploadGiftImage = makeUploader('gifts');

// ============ ADMIN: Gift boshqaruvi ============

// Barcha giftlar ro'yxati (admin ko'rinishi — to'liq ma'lumot bilan)
router.get('/admin/gifts', authMiddleware, adminMiddleware, (req, res) => {
  const gifts = db.prepare('SELECT * FROM gifts ORDER BY id DESC').all();
  res.json(gifts);
});

// Yangi gift yaratish
router.post('/admin/gifts', authMiddleware, adminMiddleware, uploadGiftImage.single('image'), (req, res) => {
  const { name, price, quantity } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Nomi va narxi kerak' });
  }
  const qty = quantity === '' || quantity === undefined || quantity === null ? null : Number(quantity);
  const imageUrl = req.file ? `/uploads/gifts/${req.file.filename}` : null;

  const result = db.prepare(
    'INSERT INTO gifts (name, image_url, price, quantity) VALUES (?, ?, ?, ?)'
  ).run(name, imageUrl, Number(price), qty);

  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(result.lastInsertRowid);
  res.json(gift);
});

// Giftni tahrirlash
router.put('/admin/gifts/:id', authMiddleware, adminMiddleware, uploadGiftImage.single('image'), (req, res) => {
  const { id } = req.params;
  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(id);
  if (!gift) return res.status(404).json({ error: 'Gift topilmadi' });

  const { name, price, quantity } = req.body;
  const newName = name !== undefined && name !== '' ? name : gift.name;
  const newPrice = price !== undefined && price !== '' ? Number(price) : gift.price;
  const newQty = quantity === '' || quantity === undefined
    ? gift.quantity
    : (quantity === 'null' ? null : Number(quantity));
  const newImage = req.file ? `/uploads/gifts/${req.file.filename}` : gift.image_url;

  db.prepare(
    'UPDATE gifts SET name = ?, price = ?, quantity = ?, image_url = ? WHERE id = ?'
  ).run(newName, newPrice, newQty, newImage, id);

  res.json(db.prepare('SELECT * FROM gifts WHERE id = ?').get(id));
});

// ============ FOYDALANUVCHI: Shop va Inventar ============

// Shop uchun gift ro'yxati (faqat qolgan soni > 0 yoki cheksiz bo'lganlar)
router.get('/gifts', authMiddleware, (req, res) => {
  const gifts = db.prepare(
    'SELECT * FROM gifts WHERE quantity IS NULL OR quantity > 0 ORDER BY id DESC'
  ).all();
  res.json(gifts);
});

// Gift sotib olish
router.post('/gifts/:id/buy', authMiddleware, (req, res) => {
  const giftId = req.params.id;
  const userId = req.user.id;

  const txn = db.transaction(() => {
    const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(giftId);
    if (!gift) throw { status: 404, message: 'Gift topilmadi' };
    if (gift.quantity !== null && gift.quantity <= 0) {
      throw { status: 400, message: 'Gift tugagan' };
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (user.coin_balance < gift.price) {
      throw { status: 400, message: 'Coin yetarli emas' };
    }

    db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(gift.price, userId);
    if (gift.quantity !== null) {
      db.prepare('UPDATE gifts SET quantity = quantity - 1 WHERE id = ?').run(giftId);
    }
    db.prepare(
      'INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)'
    ).run(userId, giftId, gift.price);

    return db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
  });

  try {
    const result = txn();
    res.json({ ok: true, coin_balance: result.coin_balance });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Xatolik yuz berdi' });
  }
});

// Foydalanuvchining inventaridagi giftlari
router.get('/inventory/gifts', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT ug.id as inventory_id, ug.bought_price, ug.acquired_at,
           g.id as gift_id, g.name, g.image_url, g.price as current_price
    FROM user_gifts ug
    JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ?
    ORDER BY ug.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// Giftni orqaga sotish — joriy narxning 80%
router.post('/inventory/gifts/:inventoryId/sell', authMiddleware, (req, res) => {
  const inventoryId = req.params.inventoryId;
  const userId = req.user.id;

  const txn = db.transaction(() => {
    const row = db.prepare(`
      SELECT ug.*, g.price as current_price
      FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
      WHERE ug.id = ? AND ug.user_id = ?
    `).get(inventoryId, userId);

    if (!row) throw { status: 404, message: 'Bunday gift inventaringizda topilmadi' };

    const sellPrice = Math.round(row.current_price * 0.8 * 100) / 100;
    db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(sellPrice, userId);
    db.prepare('DELETE FROM user_gifts WHERE id = ?').run(inventoryId);

    const user = db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(userId);
    return { sellPrice, coin_balance: user.coin_balance };
  });

  try {
    const result = txn();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Xatolik yuz berdi' });
  }
});

module.exports = router;
