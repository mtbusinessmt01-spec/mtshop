const express = require('express');
const bcrypt = require('bcryptjs');
const { upload, fileToDataUrl } = require('../imageUpload');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

// Barcha foydalanuvchilar ro'yxati
router.get('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const users = await db.prepare(
    'SELECT id, username, coin_balance, is_admin, is_blocked, status_image_url, created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json(users);
});

// Yangi hisob yaratish (register yo'q, faqat admin yaratadi)
router.post('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const { username, password, is_admin } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username va parol kerak' });
  }
  const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Bu username band' });

  const hash = bcrypt.hashSync(password, 10);
  const result = await db.prepare(
    'INSERT INTO users (username, password_hash, coin_balance, is_admin) VALUES (?, ?, 0, ?)'
  ).run(username, hash, is_admin ? 1 : 0);

  const user = await db.prepare(
    'SELECT id, username, coin_balance, is_admin, is_blocked, created_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.json(user);
});

// Hisobni tahrirlash (username, parol, admin, blok holati)
router.put('/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const { username, password, is_admin, is_blocked } = req.body || {};

  if (username && username !== user.username) {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (exists) return res.status(400).json({ error: 'Bu username band' });
  }

  const newHash = password ? bcrypt.hashSync(password, 10) : user.password_hash;

  await db.prepare(
    'UPDATE users SET username = ?, password_hash = ?, is_admin = ?, is_blocked = ? WHERE id = ?'
  ).run(
    username || user.username,
    newHash,
    is_admin !== undefined ? (is_admin ? 1 : 0) : user.is_admin,
    is_blocked !== undefined ? (is_blocked ? 1 : 0) : user.is_blocked,
    id
  );

  const updated = await db.prepare(
    'SELECT id, username, coin_balance, is_admin, is_blocked, created_at FROM users WHERE id = ?'
  ).get(id);
  res.json(updated);
});

// Foydalanuvchiga status (badge) rasmini o'rnatish
router.post('/admin/users/:id/status-image', authMiddleware, adminMiddleware, upload.single('status_image'), async (req, res) => {
  const { id } = req.params;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (!req.file) return res.status(400).json({ error: 'Rasm tanlanmadi' });

  const url = fileToDataUrl(req.file);
  await db.prepare('UPDATE users SET status_image_url = ? WHERE id = ?').run(url, id);
  res.json({ ok: true, status_image_url: url });
});

// Coin berish / olish
router.post('/admin/users/:id/coin', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { amount, action, delta } = req.body || {};

  let change;
  if (delta !== undefined) {
    change = parseFloat(delta);
  } else {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Miqdor noto'g'ri" });
    change = action === 'take' ? -amt : amt;
  }
  if (isNaN(change) || change === 0) {
    return res.status(400).json({ error: "Miqdor noto'g'ri" });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const newBalance = user.coin_balance + change;
  if (newBalance < 0) return res.status(400).json({ error: "Balans manfiy bo'lishi mumkin emas" });

  await db.prepare('UPDATE users SET coin_balance = ? WHERE id = ?').run(newBalance, id);
  res.json({ ok: true, coin_balance: newBalance });
});

// Hisobni o'chirish
router.delete('/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM user_gifts WHERE user_id = ?').run(id);
    await db.prepare('DELETE FROM user_cases WHERE user_id = ?').run(id);
    await db.prepare('DELETE FROM user_pets WHERE user_id = ?').run(id);
    await db.prepare(`
      DELETE FROM credit_payments WHERE user_credit_id IN (SELECT id FROM user_credits WHERE user_id = ?)
    `).run(id);
    await db.prepare('DELETE FROM user_credits WHERE user_id = ?').run(id);
    // Transfer tarixi saqlanadi, faqat foydalanuvchiga bog'lanish yo'qotiladi bo'lmaydi
    // (chunki from_user_id/to_user_id NOT NULL) — shuning uchun bu transferlarni o'chiramiz
    await db.prepare('DELETE FROM transfers WHERE from_user_id = ? OR to_user_id = ?').run(id, id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  await tx();

  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: qidiruv va ochiq profil ----------

// Username bo'yicha qidiruv
router.get('/users/search', authMiddleware, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = await db.prepare(
    'SELECT id, username, status_image_url FROM users WHERE username LIKE ? ORDER BY username ASC LIMIT 20'
  ).all(`%${q}%`);
  res.json(rows);
});

// Ochiq profil: username, status, giftlari, case'lari (pet mavjudligi, lekin tafsilotsiz)
router.get('/users/:username/profile', authMiddleware, async (req, res) => {
  const user = await db.prepare(
    'SELECT id, username, status_image_url, created_at FROM users WHERE username = ?'
  ).get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  const gifts = await db.prepare(`
    SELECT g.id, g.name, g.image_url, COUNT(*) as count
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id
    WHERE ug.user_id = ?
    GROUP BY g.id
  `).all(user.id);

  const cases = await db.prepare(`
    SELECT c.id, c.name, c.image_url, COUNT(*) as count
    FROM user_cases uc JOIN cases c ON c.id = uc.case_id
    WHERE uc.user_id = ?
    GROUP BY c.id
  `).all(user.id);

  // Pet mavjudligi ko'rsatiladi, lekin tafsilotlar (daromad, sog'lik) yashiriladi
  const petCountRow = await db.prepare('SELECT COUNT(*) as c FROM user_pets WHERE user_id = ?').get(user.id);
  const pets = Array(petCountRow.c).fill({});

  res.json({ ...user, gifts, cases, pets });
});

module.exports = router;
