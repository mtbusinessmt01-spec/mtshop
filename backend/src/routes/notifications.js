const express = require('express');
const N = require('../notifications');
const { authMiddleware } = require('../auth');

const router = express.Router();

// Ro'yxat: ?limit=40&before=<id> (eskilarini yuklash uchun)
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const items = await N.list(req.user.id, { limit: req.query.limit, before: req.query.before });
    const unread = await N.unreadCount(req.user.id);
    res.json({ items, unread });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Qo'ng'iroqcha belgisi uchun (yengil so'rov)
router.get('/notifications/unread-count', authMiddleware, async (req, res) => {
  try {
    res.json({ unread: await N.unreadCount(req.user.id) });
  } catch (e) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Sozlamalar
router.get('/notifications/prefs', authMiddleware, async (req, res) => {
  try {
    res.json(await N.getPrefs(req.user.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.put('/notifications/prefs', authMiddleware, async (req, res) => {
  try {
    await N.savePrefs(req.user.id, req.body);
    res.json(await N.getPrefs(req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Saqlanmadi' });
  }
});

// O'qilgan deb belgilash: { ids: [1,2] } yoki { all: true }
router.post('/notifications/read', authMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    await N.markRead(req.user.id, b.all ? 'all' : (Array.isArray(b.ids) ? b.ids : []));
    res.json({ ok: true, unread: await N.unreadCount(req.user.id) });
  } catch (e) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Hammasini tozalash
router.delete('/notifications', authMiddleware, async (req, res) => {
  try {
    await N.clearAll(req.user.id);
    res.json({ ok: true, unread: 0 });
  } catch (e) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Bittasini o'chirish
router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    await N.remove(req.user.id, req.params.id);
    res.json({ ok: true, unread: await N.unreadCount(req.user.id) });
  } catch (e) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

module.exports = router;
