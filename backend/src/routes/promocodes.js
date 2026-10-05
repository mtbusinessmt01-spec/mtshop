const express = require('express');

const promo = require('../promocodes');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof promo.PromoError) return res.status(e.status).json({ error: e.message });
    console.error('Promokod xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Foydalanuvchi: kodni ishlatish (Profils sahifasidan)
router.post('/promocodes/redeem', authMiddleware, h(async (req, res) => {
  res.json(await promo.redeem(req.user.id, req.body && req.body.code));
}));

// Admin
router.get('/admin/promocodes', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await promo.listPromos());
}));

router.post('/admin/promocodes', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await promo.createPromo(req.body));
}));

router.put('/admin/promocodes/:id/active', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await promo.setActive(req.params.id, !!(req.body && req.body.active)));
}));

router.get('/admin/promocodes/:id/redemptions', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await promo.redemptions(req.params.id));
}));

router.delete('/admin/promocodes/:id', authMiddleware, adminMiddleware, h(async (req, res) => {
  res.json(await promo.removePromo(req.params.id));
}));

module.exports = router;
