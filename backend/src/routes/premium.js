const express = require('express');
const db = require('../db');
const premium = require('../premium');
const { authMiddleware, adminMiddleware } = require('../auth');
const { requireNotFrozen } = require('../security');

const router = express.Router();

// ---------- FOYDALANUVCHI ----------
router.get('/premium', authMiddleware, async (req, res) => {
  try {
    const st = await premium.statusFor(req.user.id);
    const u = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
    res.json({ ...st, coin_balance: u ? u.coin_balance : 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server xatosi' }); }
});

router.post('/premium/buy', authMiddleware, requireNotFrozen, async (req, res) => {
  try {
    const r = await premium.buy(req.user.id);
    const st = await premium.statusFor(req.user.id);
    res.json({ ok: true, ...st, coin_balance: r.coin_balance, paid: r.price });
  } catch (e) {
    if (e.message === 'NO_COIN') return res.status(400).json({ error: 'Coin yetarli emas' });
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ---------- ADMIN ----------
router.get('/admin/premium/settings', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await premium.getSettings());
});

router.put('/admin/premium/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const r = await premium.saveSettings(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true, ...(await premium.getSettings()) });
});

router.get('/admin/premium/users', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await premium.activeUsers());
});

router.post('/admin/premium/grant', authMiddleware, adminMiddleware, async (req, res) => {
  const { username } = req.body || {};
  const days = parseInt(req.body && req.body.days, 10);
  if (!username || !isFinite(days) || days < 1 || days > 3650) {
    return res.status(400).json({ error: "Username va kun (1–3650) to'g'ri kiriting" });
  }
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(String(username));
  if (!user) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
  const until = await premium.grant(user.id, days);
  res.json({ ok: true, until });
});

router.post('/admin/premium/revoke', authMiddleware, adminMiddleware, async (req, res) => {
  const { username } = req.body || {};
  const user = username ? await db.prepare('SELECT id FROM users WHERE username = ?').get(String(username)) : null;
  if (!user) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
  await premium.revoke(user.id);
  res.json({ ok: true });
});

module.exports = router;
