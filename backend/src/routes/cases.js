const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'cases');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `case_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

async function getCaseWithItems(caseId) {
  const c = await db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!c) return null;
  const items = await db.prepare(`
    SELECT ci.*, g.name as gift_name, g.image_url as gift_image_url
    FROM case_items ci
    LEFT JOIN gifts g ON g.id = ci.gift_id
    WHERE ci.case_id = ?
  `).all(caseId);
  return { ...c, items };
}

// ---------- ADMIN: Case CRUD ----------

router.get('/admin/cases', authMiddleware, adminMiddleware, async (req, res) => {
  const cases = await db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
  res.json(await Promise.all(cases.map(c => getCaseWithItems(c.id))));
});

router.get('/admin/cases/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const c = await getCaseWithItems(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case topilmadi' });
  res.json(c);
});

// items: JSON string -> [{item_type:'gift'|'coin', gift_id, coin_amount, chance_percent}]
router.post('/admin/cases', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name, price } = req.body;
  let items;
  try { items = JSON.parse(req.body.items || '[]'); } catch { items = []; }

  if (!name || !price) return res.status(400).json({ error: "Nomi va narxi kerak" });
  if (!items.length) return res.status(400).json({ error: "Kamida bitta gift/coin qo'shish kerak" });

  const imageUrl = req.file ? `/uploads/cases/${req.file.filename}` : null;

  const tx = db.transaction(async () => {
    const result = await db.prepare(
      'INSERT INTO cases (name, image_url, price) VALUES (?, ?, ?)'
    ).run(name, imageUrl, parseFloat(price));
    const caseId = result.lastInsertRowid;

    const insertItem = db.prepare(
      'INSERT INTO case_items (case_id, item_type, gift_id, coin_amount, chance_percent) VALUES (?, ?, ?, ?, ?)'
    );
    for (const it of items) {
      await insertItem.run(
        caseId,
        it.item_type,
        it.item_type === 'gift' ? it.gift_id : null,
        it.item_type === 'coin' ? parseFloat(it.coin_amount) : null,
        parseFloat(it.chance_percent)
      );
    }
    return caseId;
  });

  const caseId = await tx();
  res.json(await getCaseWithItems(caseId));
});

router.put('/admin/cases/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Case topilmadi' });

  const { name, price } = req.body;
  let items = null;
  if (req.body.items !== undefined) {
    try { items = JSON.parse(req.body.items); } catch { items = null; }
  }
  const imageUrl = req.file ? `/uploads/cases/${req.file.filename}` : existing.image_url;

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE cases SET name = ?, price = ?, image_url = ? WHERE id = ?')
      .run(name || existing.name, price ? parseFloat(price) : existing.price, imageUrl, id);

    if (items) {
      await db.prepare('DELETE FROM case_items WHERE case_id = ?').run(id);
      const insertItem = db.prepare(
        'INSERT INTO case_items (case_id, item_type, gift_id, coin_amount, chance_percent) VALUES (?, ?, ?, ?, ?)'
      );
      for (const it of items) {
        await insertItem.run(
          id,
          it.item_type,
          it.item_type === 'gift' ? it.gift_id : null,
          it.item_type === 'coin' ? parseFloat(it.coin_amount) : null,
          parseFloat(it.chance_percent)
        );
      }
    }
  });
  await tx();

  res.json(await getCaseWithItems(id));
});

router.delete('/admin/cases/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM case_items WHERE case_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
  });
  await tx();
  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: Shop, Buy, Inventory, Open ----------

router.get('/cases', authMiddleware, async (req, res) => {
  const cases = await db.prepare('SELECT * FROM cases ORDER BY price ASC').all();
  res.json(await Promise.all(cases.map(c => getCaseWithItems(c.id))));
});

router.post('/cases/:id/buy', authMiddleware, async (req, res) => {
  const c = await db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case topilmadi' });

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.coin_balance < c.price) return res.status(400).json({ error: 'Coin yetarli emas' });

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(c.price, user.id);
    await db.prepare('INSERT INTO user_cases (user_id, case_id) VALUES (?, ?)').run(user.id, c.id);
  });
  await tx();

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

router.get('/inventory/cases', authMiddleware, async (req, res) => {
  const items = await db.prepare(`
    SELECT uc.id as inventory_id, uc.acquired_at, c.id as case_id, c.name, c.image_url, c.price
    FROM user_cases uc JOIN cases c ON c.id = uc.case_id
    WHERE uc.user_id = ?
    ORDER BY uc.acquired_at DESC
  `).all(req.user.id);
  res.json(items);
});

// Vaznlangan tasodifiy tanlov (chance_percent asosida)
function pickWeightedItem(items) {
  const total = items.reduce((sum, it) => sum + it.chance_percent, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.chance_percent;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

router.post('/inventory/cases/:inventoryId/open', authMiddleware, async (req, res) => {
  const userCase = await db.prepare(
    'SELECT * FROM user_cases WHERE id = ? AND user_id = ?'
  ).get(req.params.inventoryId, req.user.id);
  if (!userCase) return res.status(404).json({ error: 'Topilmadi' });

  const items = await db.prepare('SELECT * FROM case_items WHERE case_id = ?').all(userCase.case_id);
  if (!items.length) return res.status(400).json({ error: "Case bo'sh" });

  const won = pickWeightedItem(items);

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM user_cases WHERE id = ?').run(userCase.id);

    if (won.item_type === 'coin') {
      await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?')
        .run(won.coin_amount, req.user.id);
    } else {
      const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
      await db.prepare('INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)')
        .run(req.user.id, won.gift_id, gift ? gift.price : 0);
    }
  });
  await tx();

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);

  let wonDisplay;
  if (won.item_type === 'coin') {
    wonDisplay = { item_type: 'coin', coin_amount: won.coin_amount };
  } else {
    const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
    wonDisplay = { item_type: 'gift', gift_id: won.gift_id, name: gift?.name, image_url: gift?.image_url };
  }

  res.json({ ok: true, won: wonDisplay, coin_balance: updatedUser.coin_balance });
});

module.exports = router;
