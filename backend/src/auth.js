const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mtshop-dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Tizimga kirmagansiz' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sessiya eskirgan, qayta kiring' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  next();
}

module.exports = { signToken, authMiddleware, adminMiddleware, JWT_SECRET };
