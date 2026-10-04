const express = require('express');

const profile = require('../profile');
const { authMiddleware } = require('../auth');

const router = express.Router();

const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof profile.ProfileError) return res.status(e.status).json({ error: e.message });
    console.error('Profil xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Profile edit ekrani: joriy emoji status, qadalgan giftlar va tanlash mumkin bo'lgan giftlar
router.get('/profile/edit', authMiddleware, h(async (req, res) => {
  res.json(await profile.editData(req.user.id));
}));

router.put('/profile/emoji-status', authMiddleware, h(async (req, res) => {
  res.json(await profile.setEmoji(req.user.id, req.body && req.body.gift_id));
}));

router.delete('/profile/emoji-status', authMiddleware, h(async (req, res) => {
  res.json(await profile.clearEmoji(req.user.id));
}));

router.post('/profile/pins', authMiddleware, h(async (req, res) => {
  res.json(await profile.pinGift(req.user.id, req.body && req.body.user_gift_id));
}));

router.delete('/profile/pins/:userGiftId', authMiddleware, h(async (req, res) => {
  res.json(await profile.unpinGift(req.user.id, req.params.userGiftId));
}));

module.exports = router;
