const express = require('express');
const multer = require('multer');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { fileToDataUrl } = require('../imageUpload');

const router = express.Router();

// Event rasmlari (banner + wallpaper) biroz kattaroq bo'lishi mumkin — 3MB gacha
const eventUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Faqat rasm fayllari qabul qilinadi'));
  },
}).fields([{ name: 'banner', maxCount: 1 }, { name: 'wallpaper', maxCount: 1 }]);

// multer xatosini (masalan fayl juda katta) chiroyli xabar bilan qaytarish
function handleUpload(req, res, next) {
  eventUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Rasm 3MB dan oshmasligi kerak' });
    return res.status(400).json({ error: err.message || 'Rasm yuklashda xato' });
  });
}

function imgUrl(id, kind, version, has) {
  return has ? `/api/events/${id}/${kind}?v=${version}` : null;
}

function shapeEvent(e) {
  return {
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    created_at: e.created_at,
    banner_url: imgUrl(e.id, 'banner', e.version, e.has_banner),
    wallpaper_url: imgUrl(e.id, 'wallpaper', e.version, e.has_wallpaper),
  };
}

// base64 data URL ni oddiy rasm sifatida qaytarish (brauzer keshlaydi)
function sendDataUrl(res, dataUrl) {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl || '');
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(m[2], 'base64'));
}

const LIST_COLUMNS = `id, name, starts_at, ends_at, version, created_at,
  (banner_url IS NOT NULL) AS has_banner, (wallpaper_url IS NOT NULL) AS has_wallpaper`;

function parseDates(startsRaw, endsRaw) {
  const s = new Date(startsRaw);
  const e = new Date(endsRaw);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return { error: "Boshlanish va tugash vaqtini to'g'ri kiriting" };
  if (e <= s) return { error: "Tugash vaqti boshlanish vaqtidan keyin bo'lishi kerak" };
  return { starts_at: s.toISOString(), ends_at: e.toISOString() };
}

// ---------- RASMLAR (hammaga ochiq, faqat rasm) ----------

router.get('/events/:id/banner', async (req, res) => {
  const e = await db.prepare('SELECT banner_url FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).end();
  sendDataUrl(res, e.banner_url);
});

router.get('/events/:id/wallpaper', async (req, res) => {
  const e = await db.prepare('SELECT wallpaper_url FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).end();
  sendDataUrl(res, e.wallpaper_url);
});

// ---------- FOYDALANUVCHI: joriy / eng yaqin event ----------

router.get('/events/current', authMiddleware, async (req, res) => {
  const now = new Date();
  const e = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM events WHERE ends_at > ? ORDER BY starts_at ASC LIMIT 1`
  ).get(now.toISOString());
  if (!e) return res.json({ event: null, server_now: now.getTime() });

  const status = e.starts_at <= now.toISOString() ? 'live' : 'upcoming';
  res.json({ event: { ...shapeEvent(e), status }, server_now: now.getTime() });
});

// ---------- ADMIN ----------

router.get('/admin/events', authMiddleware, adminMiddleware, async (req, res) => {
  const events = await db.prepare(`SELECT ${LIST_COLUMNS} FROM events ORDER BY starts_at DESC`).all();
  const out = [];
  for (const e of events) {
    const gifts = await db.prepare('SELECT id, name, price FROM gifts WHERE event_id = ?').all(e.id);
    const cases = await db.prepare('SELECT id, name, price FROM cases WHERE event_id = ?').all(e.id);
    out.push({ ...shapeEvent(e), gifts, cases });
  }
  res.json(out);
});

router.post('/admin/events', authMiddleware, adminMiddleware, handleUpload, async (req, res) => {
  const { name, starts_at, ends_at } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Event nomi kerak' });
  const d = parseDates(starts_at, ends_at);
  if (d.error) return res.status(400).json({ error: d.error });

  const banner = fileToDataUrl(req.files?.banner?.[0]);
  const wallpaper = fileToDataUrl(req.files?.wallpaper?.[0]);

  const result = await db.prepare(
    'INSERT INTO events (name, banner_url, wallpaper_url, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, banner, wallpaper, d.starts_at, d.ends_at);

  const e = await db.prepare(`SELECT ${LIST_COLUMNS} FROM events WHERE id = ?`).get(result.lastInsertRowid);
  res.json(shapeEvent(e));
});

router.put('/admin/events/:id', authMiddleware, adminMiddleware, handleUpload, async (req, res) => {
  const { id } = req.params;
  const existing = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Event topilmadi' });

  const { name, starts_at, ends_at } = req.body || {};
  const d = parseDates(starts_at ?? existing.starts_at, ends_at ?? existing.ends_at);
  if (d.error) return res.status(400).json({ error: d.error });

  const newBanner = fileToDataUrl(req.files?.banner?.[0]);
  const newWallpaper = fileToDataUrl(req.files?.wallpaper?.[0]);
  const imagesChanged = !!(newBanner || newWallpaper);

  await db.prepare(`
    UPDATE events SET name = ?, banner_url = ?, wallpaper_url = ?, starts_at = ?, ends_at = ?, version = version + ?
    WHERE id = ?
  `).run(
    name || existing.name,
    newBanner || existing.banner_url,
    newWallpaper || existing.wallpaper_url,
    d.starts_at, d.ends_at,
    imagesChanged ? 1 : 0,
    id
  );

  const e = await db.prepare(`SELECT ${LIST_COLUMNS} FROM events WHERE id = ?`).get(id);
  res.json(shapeEvent(e));
});

// Event'ni o'chirish:
// - hali boshlanmagan bo'lsa: uning gift va case'lari ham o'chiriladi (hech kim ularga ega emas)
// - boshlangan bo'lsa: gift va case'lar saqlanadi, oddiy (event'siz) holatga o'tadi
router.delete('/admin/events/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Event topilmadi' });

  const started = ev.starts_at <= new Date().toISOString();

  const tx = db.transaction(async () => {
    if (!started) {
      const cases = await db.prepare('SELECT id FROM cases WHERE event_id = ?').all(id);
      for (const c of cases) {
        await db.prepare('DELETE FROM user_cases WHERE case_id = ?').run(c.id);
        await db.prepare('UPDATE transfers SET case_id = NULL WHERE case_id = ?').run(c.id);
        await db.prepare('DELETE FROM case_items WHERE case_id = ?').run(c.id);
        await db.prepare('DELETE FROM cases WHERE id = ?').run(c.id);
      }
      const gifts = await db.prepare('SELECT id FROM gifts WHERE event_id = ?').all(id);
      for (const g of gifts) {
        await db.prepare('DELETE FROM user_gifts WHERE gift_id = ?').run(g.id);
        await db.prepare('DELETE FROM case_items WHERE gift_id = ?').run(g.id);
        await db.prepare('UPDATE transfers SET gift_id = NULL WHERE gift_id = ?').run(g.id);
        await db.prepare('DELETE FROM gifts WHERE id = ?').run(g.id);
      }
    } else {
      await db.prepare('UPDATE gifts SET event_id = NULL WHERE event_id = ?').run(id);
      await db.prepare('UPDATE cases SET event_id = NULL WHERE event_id = ?').run(id);
    }
    await db.prepare('DELETE FROM events WHERE id = ?').run(id);
  });
  await tx();
  res.json({ ok: true, items_deleted: !started });
});

module.exports = router;
