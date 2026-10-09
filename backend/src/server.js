require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('./db');
const jwt = require('jsonwebtoken');
const { signToken, setAuthCookie, authMiddleware, adminMiddleware, JWT_SECRET } = require('./auth');
const security = require('./security');
const giftsRouter = require('./routes/gifts');
const casesRouter = require('./routes/cases');
const usersRouter = require('./routes/users');
const transfersRouter = require('./routes/transfers');
const creditsRouter = require('./routes/credits');
const petsRouter = require('./routes/pets');
const pushRouter = require('./routes/push');
const eventsRouter = require('./routes/events');
const versionsRouter = require('./routes/versions');
const tradesRouter = require('./routes/trades');
const profileRouter = require('./routes/profile');
const promocodesRouter = require('./routes/promocodes');
const securityRouter = require('./routes/security');
const profileSvc = require('./profile');
const trades = require('./trades');
const { pageMiddleware } = require('./versions');
const push = require('./push');
const guarantor = require('./guarantor');

const app = express();
// Render proxy orqasida: haqiqiy mijoz IP'si (kirish tarixi uchun) X-Forwarded-For dan olinadi
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Frontend (login.html, index.html, admin.html va h.k.) endi shu backend orqali
// beriladi — shunda ikkalasi bitta manzilda bo'lib, brauzer cookie'ni
// "cross-site" deb hisoblamaydi (mobil Safari'dagi bloklash muammosi yo'qoladi).
const frontendDir = path.join(__dirname, '..', '..', 'frontend', 'public');
// Foydalanuvchi versiyasiga mos index.html (static'dan OLDIN turishi shart)
app.use(pageMiddleware);
app.use(express.static(frontendDir));

app.use('/api', giftsRouter);
app.use('/api', casesRouter);
app.use('/api', usersRouter);
app.use('/api', transfersRouter);
app.use('/api', creditsRouter);
app.use('/api', petsRouter);
app.use('/api', pushRouter);
app.use('/api', eventsRouter);
app.use('/api', versionsRouter);
app.use('/api', tradesRouter);
app.use('/api', profileRouter);
app.use('/api', promocodesRouter);
app.use('/api', securityRouter);

// --- AUTH ---

// Login: username + password orqali (register yo'q, hisoblarni faqat admin yaratadi)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username va parol kerak' });
    }
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Username yoki parol xato' });
    if (user.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      // Kirish tarixiga yoziladi; qisqa vaqtda ko'p marta xato bo'lsa egasiga push boradi
      try { await security.recordFailedLogin(user.id, req); } catch (e) { console.error('Kirish tarixi xatosi:', e); }
      return res.status(401).json({ error: 'Username yoki parol xato' });
    }

    // Har kirish — alohida sessiya (faol qurilmalar ro'yxati uchun)
    const sid = await security.createSession(user.id, req);
    setAuthCookie(req, res, signToken(user, sid));
    try { await security.recordLogin(user.id, req); } catch (e) { console.error('Kirish tarixi xatosi:', e); }
    res.json({
      id: user.id,
      username: user.username,
      coin_balance: user.coin_balance,
      is_admin: !!user.is_admin,
      status_image_url: user.status_image_url,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  // Chiqqan qurilmaning sessiyasi ham bekor qilinadi
  try {
    const t = req.cookies && req.cookies.token;
    if (t) {
      const p = jwt.verify(t, JWT_SECRET, { ignoreExpiration: true });
      if (p && p.sid) await security.revokeSession(p.sid, p.id);
    }
  } catch (e) { /* yaroqsiz token — shunchaki cookie tozalanadi */ }
  res.clearCookie('token', { sameSite: 'none', secure: true });
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.prepare(
      'SELECT id, username, coin_balance, is_admin, status_image_url, created_at FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Topilmadi' });
    const emoji = await profileSvc.emojiFor(user.id);   // egalik va narx qayta tekshiriladi
    res.json({ ...user, emoji_gift_id: emoji ? emoji.gift_id : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// --- Health check ---
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Har qanday kutilmagan xato uchun umumiy ushlagich (async route'lar ichida throw bo'lsa)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server xatosi' });
});

const PORT = process.env.PORT || 4000;

db.initDb()
  .then(() => push.initPush())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MTshop backend http://localhost:${PORT} da ishlamoqda`);
    });
    push.startScheduler();
    guarantor.startScheduler();
    trades.startScheduler();
  })
  .catch((e) => {
    console.error('Bazani ishga tushirishda xato:', e);
    process.exit(1);
  });

// redeploy
