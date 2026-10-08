const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mtshop-dev-secret-change-me';

// sid — sessiya identifikatori (sessions jadvali). Faol qurilmalar va "boshqa qurilmalardan chiqish" shunga tayanadi.
function signToken(user, sid) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, sid },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function setAuthCookie(req, res, token) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 7 * 24 * 60 * 60 * 1000,
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

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  next();
}

module.exports = { signToken, setAuthCookie, authMiddleware, adminMiddleware, JWT_SECRET };
