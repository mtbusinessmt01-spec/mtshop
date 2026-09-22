require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('./db');
const { signToken, authMiddleware, adminMiddleware } = require('./auth');
const giftsRouter = require('./routes/gifts');
const casesRouter = require('./routes/cases');
const usersRouter = require('./routes/users');
const transfersRouter = require('./routes/transfers');
const creditsRouter = require('./routes/credits');
const petsRouter = require('./routes/pets');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use('/api', giftsRouter);
app.use('/api', casesRouter);
app.use('/api', usersRouter);
app.use('/api', transfersRouter);
app.use('/api', creditsRouter);
app.use('/api', petsRouter);

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
    if (!ok) return res.status(401).json({ error: 'Username yoki parol xato' });

    const token = signToken(user);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
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

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { sameSite: 'none', secure: true });
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.prepare(
      'SELECT id, username, coin_balance, is_admin, status_image_url, created_at FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Topilmadi' });
    res.json(user);
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
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MTshop backend http://localhost:${PORT} da ishlamoqda`);
    });
  })
  .catch((e) => {
    console.error('Bazani ishga tushirishda xato:', e);
    process.exit(1);
  });