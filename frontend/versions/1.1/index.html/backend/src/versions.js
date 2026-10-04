const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const db = require('./db');
const { JWT_SECRET } = require('./auth');

// Hamma foydalanuvchi sukut bo'yicha shu versiyada (frontend/public/index.html)
const BASE_VERSION = '1.2';
const VERSION_RE = /^\d+(\.\d+){1,2}$/;

// Yangi versiya sahifalari ochiq papkada EMAS: frontend/versions/<versiya>/index.html
// (express.static ularni to'g'ridan-to'g'ri bermaydi, faqat ruxsati bor foydalanuvchiga beriladi)
const versionsDir = path.join(__dirname, '..', '..', 'frontend', 'versions');

function pageFile(version) {
  if (!VERSION_RE.test(version)) return null;
  return path.join(versionsDir, version, 'index.html');
}

function pageExists(version) {
  const f = pageFile(version);
  return !!f && fs.existsSync(f);
}

// Foydalanuvchi shu versiyani ishlata oladimi?
// draft — faqat admin, beta — admin va tanlangan testerlar, public — hamma
async function canUse(user, version) {
  if (version === BASE_VERSION) return true;
  if (!pageExists(version)) return false;
  const row = await db.prepare('SELECT * FROM app_versions WHERE version = ?').get(version);
  if (!row) return false;
  if (row.status === 'public') return true;
  if (user.is_admin) return true;
  if (row.status === 'beta') {
    const t = await db.prepare(
      'SELECT 1 AS ok FROM app_version_testers WHERE version_id = ? AND user_id = ?'
    ).get(row.id, user.id);
    return !!t;
  }
  return false;
}

// Haqiqatda ko'rsatiladigan versiya: bazadagi qiymat ruxsatdan o'tmasa, asosiy versiyaga qaytadi
async function effectiveVersion(user) {
  const v = user.app_version || BASE_VERSION;
  if (v === BASE_VERSION) return BASE_VERSION;
  return (await canUse(user, v)) ? v : BASE_VERSION;
}

// Versiya holati yoki testerlar o'zgargach, ruxsati qolmagan foydalanuvchilarni asosiy versiyaga qaytaradi
async function enforceAccess(row) {
  if (row.status === 'draft') {
    await db.prepare('UPDATE users SET app_version = ? WHERE app_version = ? AND is_admin = 0')
      .run(BASE_VERSION, row.version);
  } else if (row.status === 'beta') {
    await db.prepare(`
      UPDATE users SET app_version = ?
      WHERE app_version = ? AND is_admin = 0
        AND id NOT IN (SELECT user_id FROM app_version_testers WHERE version_id = ?)
    `).run(BASE_VERSION, row.version, row.id);
  }
}

// "/" va "/index.html" so'ralganda foydalanuvchining versiyasiga mos sahifani beradi.
// Versiya asosiy bo'lsa yoki tizimga kirilmagan bo'lsa — oddiy static fayl (index.html) beriladi.
function pageMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  if (req.path !== '/' && req.path !== '/index.html') return next();

  const token = req.cookies && req.cookies.token;
  if (!token) return next();
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { return next(); }

  (async () => {
    const user = await db.prepare(
      'SELECT id, is_admin, app_version FROM users WHERE id = ?'
    ).get(payload.id);
    if (!user) return next();
    const ver = await effectiveVersion(user);
    if (ver === BASE_VERSION) return next();
    res.set('Cache-Control', 'no-store');
    res.sendFile(pageFile(ver));
  })().catch((e) => {
    console.error('Versiya sahifasini berishda xato:', e);
    next();
  });
}

module.exports = {
  BASE_VERSION, VERSION_RE, pageExists, canUse, effectiveVersion, enforceAccess, pageMiddleware,
};
