const express = require('express');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const COMMISSION_RATE = 0.03; // 3%

async function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// ---------- FOYDALANUVCHI: yuborish ----------

// Coin yuborish — 3% komissiya bilan (100 yuborsa, 103 yechiladi)
router.post('/transfers/coin', authMiddleware, async (req, res) => {
  const { to_username, amount, is_anonymous } = req.body || {};
  const amt = parseFloat(amount);
  if (!to_username || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: "Username va miqdor to'g'ri kiriting" });
  }
  if (to_username === req.user.username) {
    return res.status(400).json({ error: "O'zingizga yubora olmaysiz" });
  }

  const toUser = await findUserByUsername(to_username);
  if (!toUser) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });

  const commission = Math.round(amt * COMMISSION_RATE * 100) / 100;
  const totalDeduct = amt + commission;

  const fromUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (fromUser.coin_balance < totalDeduct) {
    return res.status(400).json({ error: `Coin yetarli emas (komissiya bilan ${totalDeduct} kerak)` });
  }

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(totalDeduct, fromUser.id);
    await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(amt, toUser.id);
    await db.prepare(`
      INSERT INTO transfers (from_user_id, to_user_id, item_type, coin_amount, commission, is_anonymous)
      VALUES (?, ?, 'coin', ?, ?, ?)
    `).run(fromUser.id, toUser.id, amt, commission, is_anonymous ? 1 : 0);
  });
  await tx();

  const updated = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(fromUser.id);
  res.json({ ok: true, coin_balance: updated.coin_balance, sent: amt, commission });
});

// Gift yuborish (inventardagi bitta dona)
router.post('/transfers/gift', authMiddleware, async (req, res) => {
  const { to_username, inventory_id, is_anonymous } = req.body || {};
  if (!to_username || !inventory_id) {
    return res.status(400).json({ error: 'Username va gift tanlanishi kerak' });
  }
  if (to_username === req.user.username) {
    return res.status(400).json({ error: "O'zingizga yubora olmaysiz" });
  }

  const toUser = await findUserByUsername(to_username);
  if (!toUser) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });

  const item = await db.prepare('SELECT * FROM user_gifts WHERE id = ? AND user_id = ?').get(inventory_id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Gift inventaringizda topilmadi' });

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE user_gifts SET user_id = ? WHERE id = ?').run(toUser.id, item.id);
    await db.prepare(`
      INSERT INTO transfers (from_user_id, to_user_id, item_type, gift_id, is_anonymous)
      VALUES (?, ?, 'gift', ?, ?)
    `).run(req.user.id, toUser.id, item.gift_id, is_anonymous ? 1 : 0);
  });
  await tx();

  res.json({ ok: true });
});

// Case yuborish (inventardagi bitta dona, hali ochilmagan)
router.post('/transfers/case', authMiddleware, async (req, res) => {
  const { to_username, inventory_id, is_anonymous } = req.body || {};
  if (!to_username || !inventory_id) {
    return res.status(400).json({ error: 'Username va case tanlanishi kerak' });
  }
  if (to_username === req.user.username) {
    return res.status(400).json({ error: "O'zingizga yubora olmaysiz" });
  }

  const toUser = await findUserByUsername(to_username);
  if (!toUser) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });

  const item = await db.prepare('SELECT * FROM user_cases WHERE id = ? AND user_id = ?').get(inventory_id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Case inventaringizda topilmadi' });

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE user_cases SET user_id = ? WHERE id = ?').run(toUser.id, item.id);
    await db.prepare(`
      INSERT INTO transfers (from_user_id, to_user_id, item_type, case_id, is_anonymous)
      VALUES (?, ?, 'case', ?, ?)
    `).run(req.user.id, toUser.id, item.case_id, is_anonymous ? 1 : 0);
  });
  await tx();

  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: kelgan narsalar bildirishnomasi ----------

// Hali ko'rilmagan (seen=0) kelgan transferlar
router.get('/transfers/unseen', authMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT t.*, fu.username as from_username, g.name as gift_name, g.image_url as gift_image_url,
           c.name as case_name, c.image_url as case_image_url
    FROM transfers t
    JOIN users fu ON fu.id = t.from_user_id
    LEFT JOIN gifts g ON g.id = t.gift_id
    LEFT JOIN cases c ON c.id = t.case_id
    WHERE t.to_user_id = ? AND t.seen = 0
    ORDER BY t.created_at ASC
  `).all(req.user.id);

  const result = rows.map(r => ({
    id: r.id,
    item_type: r.item_type,
    coin_amount: r.coin_amount,
    commission: r.commission,
    gift_name: r.gift_name,
    gift_image_url: r.gift_image_url,
    case_name: r.case_name,
    case_image_url: r.case_image_url,
    from_username: r.is_anonymous ? null : r.from_username,
    created_at: r.created_at,
  }));
  res.json(result);
});

// Bildirishnomalarni "ko'rilgan" deb belgilash (qayta chiqmasligi uchun)
router.post('/transfers/mark-seen', authMiddleware, async (req, res) => {
  await db.prepare('UPDATE transfers SET seen = 1 WHERE to_user_id = ? AND seen = 0').run(req.user.id);
  res.json({ ok: true });
});

// ---------- ADMIN: tarix ----------

router.get('/admin/transfers', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT t.*, 
           fu.username as from_username, 
           tu.username as to_username,
           g.name as gift_name,
           c.name as case_name
    FROM transfers t
    JOIN users fu ON fu.id = t.from_user_id
    JOIN users tu ON tu.id = t.to_user_id
    LEFT JOIN gifts g ON g.id = t.gift_id
    LEFT JOIN cases c ON c.id = t.case_id
    ORDER BY t.created_at DESC
  `).all();
  res.json(rows);
});

router.delete('/admin/transfers/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
