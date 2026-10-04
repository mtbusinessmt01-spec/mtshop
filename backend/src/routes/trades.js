const express = require('express');

const db = require('../db');
const trades = require('../trades');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();
const { TradeError } = trades;

// Async handler: TradeError -> mos HTTP status, qolgan xatolar -> 500 (ichki tafsilot oshkor qilinmaydi)
const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof TradeError) {
      return res.status(e.status).json({ error: e.message, ...e.extra });
    }
    console.error('Trade xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Gift rasmi alohida beriladi (polling javoblari yengil bo'lishi uchun base64 rasm JSON'ga qo'shilmaydi)
router.get('/gift-image/:id', authMiddleware, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
  const g = await db.prepare('SELECT image_url FROM gifts WHERE id = ?').get(id);
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec((g && g.image_url) || '');
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(m[2], 'base64'));
}));

// ---------- FOYDALANUVCHI ----------

router.get('/trades/summary', authMiddleware, h(async (req, res) => {
  res.json(await trades.summary(req.user.id));
}));

router.get('/trades/history', authMiddleware, h(async (req, res) => {
  res.json(await trades.history(req.user.id, req.query.limit));
}));

router.post('/trades/notifications/seen', authMiddleware, h(async (req, res) => {
  const ids = req.body && req.body.all ? 'all' : (req.body && req.body.ids);
  await trades.markNotificationsSeen(req.user.id, ids);
  res.json({ ok: true });
}));

router.get('/trades/available-gifts', authMiddleware, h(async (req, res) => {
  res.json(await trades.availableGifts(req.user.id));
}));

// Trade Request yuborish (oldindan gift/coin tanlash shart emas)
router.post('/trades/request', authMiddleware, h(async (req, res) => {
  res.json(await trades.createRequest(req.user.id, req.body && req.body.username));
}));

router.get('/trades/:id', authMiddleware, h(async (req, res) => {
  await trades.sweepExpired();
  res.json(await trades.viewTrade(req.user.id, req.params.id, req.query.after));
}));

router.post('/trades/:id/accept', authMiddleware, h(async (req, res) => {
  res.json(await trades.acceptRequest(req.user.id, req.params.id));
}));

router.post('/trades/:id/reject', authMiddleware, h(async (req, res) => {
  res.json(await trades.declineRequest(req.user.id, req.params.id));
}));

router.post('/trades/:id/cancel', authMiddleware, h(async (req, res) => {
  res.json(await trades.cancelTrade(req.user.id, req.params.id));
}));

router.post('/trades/:id/messages', authMiddleware, h(async (req, res) => {
  res.json(await trades.postMessage(req.user.id, req.params.id, req.body && req.body.text));
}));

router.post('/trades/:id/offer/gift', authMiddleware, h(async (req, res) => {
  res.json(await trades.addGift(req.user.id, req.params.id, req.body && req.body.user_gift_id));
}));

router.delete('/trades/:id/offer/gift/:userGiftId', authMiddleware, h(async (req, res) => {
  res.json(await trades.removeGift(req.user.id, req.params.id, req.params.userGiftId));
}));

router.put('/trades/:id/offer/coin', authMiddleware, h(async (req, res) => {
  res.json(await trades.setCoin(req.user.id, req.params.id, req.body && req.body.amount));
}));

router.post('/trades/:id/lock', authMiddleware, h(async (req, res) => {
  res.json(await trades.lockOffer(req.user.id, req.params.id));
}));

router.post('/trades/:id/unlock', authMiddleware, h(async (req, res) => {
  res.json(await trades.unlockOffer(req.user.id, req.params.id));
}));

router.post('/trades/:id/confirm', authMiddleware, h(async (req, res) => {
  res.json(await trades.confirmTrade(req.user.id, req.params.id));
}));

// ---------- ADMIN (faqat ko'rish; admin trade holatini / offerni o'zgartira olmaydi) ----------

router.get('/admin/trades', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await trades.adminList({
    q: req.query.q, status: req.query.status, from: req.query.from, to: req.query.to,
  }));
}));

router.get('/admin/trades/:id', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await trades.adminDetail(req.params.id));
}));

// Chatni ochish audit logga yoziladi (admin_chat_viewed)
router.get('/admin/trades/:id/chat', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await trades.adminOpenChat(req.user.id, req.params.id));
}));

module.exports = router;
