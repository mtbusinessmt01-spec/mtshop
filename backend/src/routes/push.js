const express = require('express');
const { upload } = require('../imageUpload');
const db = require('../db');
const push = require('../push');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

// ---------- FOYDALANUVCHI: obuna ----------

router.get('/push/public-key', authMiddleware, (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push tizimi hali tayyor emas' });
  res.json({ publicKey: key });
});

router.post('/push/subscribe', authMiddleware, async (req, res) => {
  try {
    await push.saveSubscription(req.user.id, req.body && req.body.subscription);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Obuna saqlanmadi' });
  }
});

router.post('/push/unsubscribe', authMiddleware, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint === 'string') await push.removeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

// Bu foydalanuvchining qurilmalari obuna bo'lganmi (Profils sahifasidagi holat uchun)
router.get('/push/status', authMiddleware, async (req, res) => {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(req.user.id);
  res.json({ devices: Number(row.c) });
});

// ---------- Push rasmlari (ochiq: brauzer/OS cookie'siz yuklaydi) ----------

router.get('/push/image/:id', async (req, res) => {
  const img = await db.prepare('SELECT mime, data FROM push_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).end();
  res.set('Content-Type', img.mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(img.data, 'base64'));
});

// ---------- ADMIN ----------

router.get('/admin/push/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const devices = await db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions').get();
  const users = await db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM push_subscriptions').get();
  const subscribedUsers = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
  res.json({
    devices: Number(devices.c),
    users: Number(users.c),
    subscribed_user_ids: subscribedUsers.map(r => r.user_id),
  });
});

function cleanLink(link) {
  const l = String(link || '').trim();
  if (!l) return '/index.html';
  if (l.startsWith('/') && !l.startsWith('//')) return l;
  if (/^https:\/\//i.test(l)) return l;
  return null; // noto'g'ri format
}

router.post('/admin/push/send', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const target = String(req.body.target || 'all');

  if (!title || !body) return res.status(400).json({ error: 'Sarlavha va matn kiritilishi shart' });
  if (title.length > 80) return res.status(400).json({ error: 'Sarlavha 80 belgidan oshmasligi kerak' });
  if (body.length > 300) return res.status(400).json({ error: 'Matn 300 belgidan oshmasligi kerak' });

  const url = cleanLink(req.body.url);
  if (url === null) return res.status(400).json({ error: "Link '/' bilan (masalan /index.html) yoki https:// bilan boshlanishi kerak" });

  // Rasm (ixtiyoriy): bazaga saqlab, ochiq manzil beramiz
  let imageUrl;
  if (req.file) {
    const r = await db.prepare('INSERT INTO push_images (mime, data) VALUES (?, ?)')
      .run(req.file.mimetype, req.file.buffer.toString('base64'));
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    imageUrl = `${proto}://${req.get('host')}/api/push/image/${r.lastInsertRowid}`;
  }

  const payload = { title, body, url, image: imageUrl, tag: 'admin-message' };
  let result;

  if (target === 'all') {
    result = await push.sendToAll(payload);
  } else if (target === 'user' || target === 'users') {
    let ids = [];
    try { ids = JSON.parse(req.body.user_ids || '[]'); } catch { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    ids = ids.map(Number).filter(Boolean);
    if (target === 'user') ids = ids.slice(0, 1);
    if (!ids.length) return res.status(400).json({ error: 'Foydalanuvchi tanlanmagan' });
    result = await push.sendToUsers(ids, payload);
  } else {
    return res.status(400).json({ error: "Noto'g'ri qabul qiluvchi turi" });
  }

  res.json({ ok: true, ...result });
});

module.exports = router;
