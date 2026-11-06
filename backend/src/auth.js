const jwt = require('jsonwebtoken');

// JWT_SECRET muhit o'zgaruvchisi MAJBURIY. Ochiq (kodda yozilgan) kalit bilan har kim admin token yasay olardi.
//  * Hostingda (Render / NODE_ENV=production) o'rnatilmagan bo'lsa: sayt ishlayveradi, lekin har ishga tushganda
//    TASODIFIY kalit yaratiladi (hamma qayta kiradi) va logda katta ogohlantirish chiqadi — JWT_SECRET ni qo'ying.
//  * Noutbukda (mahalliy) sinash uchun eski dev kalit ishlatiladi.
const crypto = require('crypto');
const IS_HOSTED = !!process.env.RENDER || process.env.NODE_ENV === 'production';
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  if (IS_HOSTED) {
    // Barqaror zaxira kalit: Turso tokenidan hosil qilinadi (u maxfiy va server qayta ishga tushganda o'zgarmaydi).
    // Shunda JWT_SECRET qo'yilmagan bo'lsa ham foydalanuvchilar server uyg'onganda tizimdan chiqib ketmaydi.
    const base = process.env.TURSO_AUTH_TOKEN || process.env.MERCHANT_SECRET || '';
    if (base.length >= 16) {
      JWT_SECRET = crypto.createHmac('sha256', 'mtshop-jwt-v1').update(base).digest('hex');
      console.warn('Ogohlantirish: JWT_SECRET o\'rnatilmagan — barqaror zaxira kalit ishlatilmoqda. Render > Environment ga JWT_SECRET qo\'shish tavsiya etiladi.');
    } else {
      JWT_SECRET = crypto.randomBytes(48).toString('hex');
      console.error('!!! XAVFSIZLIK: JWT_SECRET o\'rnatilmagan — har qayta ishga tushganda hamma tizimdan chiqadi. Render > Environment ga JWT_SECRET qo\'shing.');
    }
  } else {
    JWT_SECRET = 'mtshop-dev-secret-change-me';
    console.warn('Ogohlantirish: JWT_SECRET yo\'q — faqat mahalliy sinov uchun dev kalit ishlatilmoqda.');
  }
}

// sid — sessiya identifikatori (sessions jadvali). Faol qurilmalar va "boshqa qurilmalardan chiqish" shunga tayanadi.
function signToken(user, sid) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, sid },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(req, res, token) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

async function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Tizimga kirmagansiz' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sessiya eskirgan, qayta kiring' });
  }

  try {
    const security = require('./security');   // sikl bo'lmasligi uchun shu yerda yuklanadi

    if (payload.sid) {
      const state = await security.checkSession(payload.sid, payload.id);
      if (state === 'revoked') {
        return res.status(401).json({ error: 'Bu qurilmadan chiqarilgansiz. Qayta kiring', session_revoked: true });
      }
      if (state === 'blocked') return res.status(403).json({ error: 'Hisobingiz bloklangan' });
    } else {
      // Eski token (sid yo'q): "boshqa qurilmalardan chiqish" bekor qilmaganmi tekshiriladi,
      // so'ng sessiyaga aylantiriladi — hech kim tizimdan chiqib ketmaydi.
      const db = require('./db');
      const u = await db.prepare('SELECT is_blocked, sessions_valid_after FROM users WHERE id = ?').get(payload.id);
      if (!u) return res.status(401).json({ error: 'Sessiya eskirgan, qayta kiring' });
      if (u.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });
      if (u.sessions_valid_after && payload.iat * 1000 <= security.parseTs(u.sessions_valid_after)) {
        return res.status(401).json({ error: 'Bu qurilmadan chiqarilgansiz. Qayta kiring', session_revoked: true });
      }
      const sid = await security.createSession(payload.id, req);
      setAuthCookie(req, res, signToken(payload, sid));
      payload = { ...payload, sid };
    }
    req.user = payload;
    next();
  } catch (e) {
    console.error('Auth xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

// Admin huquqi tokendan EMAS, har so'rovda bazadan tekshiriladi:
// adminlikdan olingan yoki bloklangan foydalanuvchi eski token bilan ham admin amallarini bajara olmaydi.
async function adminMiddleware(req, res, next) {
  try {
    if (!req.user?.id) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const db = require('./db');
    const u = await db.prepare('SELECT is_admin, is_blocked FROM users WHERE id = ?').get(req.user.id);
    if (!u || !u.is_admin || u.is_blocked) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    req.user.is_admin = 1;
    next();
  } catch (e) {
    console.error('Admin tekshiruvi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

module.exports = { signToken, setAuthCookie, authMiddleware, adminMiddleware, JWT_SECRET };
