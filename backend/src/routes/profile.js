const express = require('express');

const profile = require('../profile');
const { authMiddleware } = require('../auth');
const { upload } = require('../imageUpload');

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

router.put('/profile/pins/order', authMiddleware, h(async (req, res) => {
  res.json(await profile.reorderPins(req.user.id, req.body && req.body.user_gift_ids));
}));

router.delete('/profile/pins/:userGiftId', authMiddleware, h(async (req, res) => {
  res.json(await profile.unpinGift(req.user.id, req.params.userGiftId));
}));

// Ism Familiya (foydalanuvchi o'zi o'zgartiradi). Bo'sh matn yuborilsa ism o'chiriladi.
router.put('/profile/me', authMiddleware, h(async (req, res) => {
  res.json(await profile.setFullName(req.user.id, req.body && req.body.full_name));
}));

// Profil rasmi: mijoz 320x320 JPEG qilib yuboradi (multipart, maydon nomi "avatar")
router.post('/profile/avatar', authMiddleware, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Rasm hajmi juda katta' : "Rasmni yuklab bo'lmadi" });
    }
    next();
  });
}, h(async (req, res) => {
  res.json(await profile.setAvatar(req.user.id, req.file));
}));

router.delete('/profile/avatar', authMiddleware, h(async (req, res) => {
  res.json(await profile.clearAvatar(req.user.id));
}));

// Rasm alohida beriladi (JSON javoblar yengil bo'lishi uchun base64 qo'shilmaydi). URL'dagi ?v= o'zgarsa yangi rasm olinadi.
router.get('/users/:id/avatar', authMiddleware, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).end();
  const f = await profile.avatarFile(id);
  if (!f) return res.status(404).end();
  res.set('Content-Type', f.mime);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(f.buffer);
}));

module.exports = router;
