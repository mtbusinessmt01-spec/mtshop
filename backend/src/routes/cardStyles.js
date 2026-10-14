const express = require('express');

const svc = require('../cardStyles');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof svc.StyleError) return res.status(e.status).json({ error: e.message });
    console.error('Karta uslubi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Foydalanuvchi
router.get('/card-styles', authMiddleware, h(async (req, res) => {
  res.json(await svc.listFor(req.user.id));
}));

router.put('/card-styles/select', authMiddleware, h(async (req, res) => {
  res.json(await svc.select(req.user.id, req.body && req.body.style_id));
}));

router.post('/card-styles/:id/buy', authMiddleware, h(async (req, res) => {
  res.json(await svc.buy(req.user.id, req.params.id));
}));

// Admin
router.get('/admin/card-styles', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await svc.adminList());
}));

router.post('/admin/card-styles', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await svc.adminCreate(req.body));
}));

router.put('/admin/card-styles/:id', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await svc.adminUpdate(req.params.id, req.body));
}));

router.delete('/admin/card-styles/:id', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await svc.adminDelete(req.params.id));
}));

module.exports = router;
