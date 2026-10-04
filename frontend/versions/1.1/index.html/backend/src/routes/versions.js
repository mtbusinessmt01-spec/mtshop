const express = require('express');

const db = require('../db');
const push = require('../push');
const { authMiddleware, adminMiddleware } = require('../auth');
const {
  BASE_VERSION, VERSION_RE, pageExists, canUse, effectiveVersion, enforceAccess,
} = require('../versions');

const router = express.Router();

async function getUser(id) {
  return db.prepare('SELECT id, is_admin, app_version FROM users WHERE id = ?').get(id);
}

// ---------- FOYDALANUVCHI ----------

// Joriy versiya va yuklab olish mumkin bo'lgan boshqa versiyalar
router.get('/versions/me', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Topilmadi' });

  const current = await effectiveVersion(user);
  const rows = await db.prepare('SELECT * FROM app_versions ORDER BY id DESC').all();
  const available = [];
  for (const r of rows) {
    if (r.version === current) continue;
    if (await canUse(user, r.version)) {
      available.push({ version: r.version, title: r.title, changelog: r.changelog, status: r.status });
    }
  }
  res.json({ base: BASE_VERSION, current, available });
});

// Versiyani almashtirish (frontend "yuklab olish" animatsiyasi tugagach chaqiradi).
// Ruxsatni faqat server hal qiladi — brauzerga ishonilmaydi.
router.post('/versions/switch', authMiddleware, async (req, res) => {
  const version = String((req.body && req.body.version) || '');
  if (!VERSION_RE.test(version)) return res.status(400).json({ error: "Versiya noto'g'ri" });

  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Topilmadi' });
  if (!(await canUse(user, version))) {
    return res.status(403).json({ error: 'Bu versiya sizga hozircha ochiq emas' });
  }
  await db.prepare('UPDATE users SET app_version = ? WHERE id = ?').run(version, user.id);
  res.json({ ok: true, version });
});

// ---------- ADMIN ----------

router.get('/admin/versions', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM app_versions ORDER BY id DESC').all();
  const counts = await db.prepare('SELECT app_version AS v, COUNT(*) AS c FROM users GROUP BY app_version').all();
  const countMap = {};
  counts.forEach(c => { countMap[c.v] = c.c; });
  const total = counts.reduce((a, c) => a + c.c, 0);

  const out = [];
  for (const r of rows) {
    const testers = await db.prepare('SELECT user_id FROM app_version_testers WHERE version_id = ?').all(r.id);
    out.push({
      ...r,
      user_count: countMap[r.version] || 0,
      tester_ids: testers.map(t => t.user_id),
      has_files: pageExists(r.version),
    });
  }
  res.json({ base: BASE_VERSION, base_count: countMap[BASE_VERSION] || 0, total_users: total, versions: out });
});

router.post('/admin/versions', authMiddleware, adminMiddleware, async (req, res) => {
  const version = String((req.body && req.body.version) || '').trim();
  const title = String((req.body && req.body.title) || '').trim().slice(0, 80);
  const changelog = String((req.body && req.body.changelog) || '').trim().slice(0, 2000);

  if (!VERSION_RE.test(version)) return res.status(400).json({ error: "Versiya raqami noto'g'ri (masalan: 1.3)" });
  if (version === BASE_VERSION) return res.status(400).json({ error: `${BASE_VERSION} — asosiy versiya, uni qo'shib bo'lmaydi` });
  const exists = await db.prepare('SELECT id FROM app_versions WHERE version = ?').get(version);
  if (exists) return res.status(400).json({ error: 'Bu versiya allaqachon bor' });

  const r = await db.prepare(
    "INSERT INTO app_versions (version, title, changelog, status) VALUES (?, ?, ?, 'draft')"
  ).run(version, title, changelog);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// Nomi, changelog va holatini (draft / beta / public) o'zgartirish
router.put('/admin/versions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const row = await db.prepare('SELECT * FROM app_versions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Versiya topilmadi' });

  const body = req.body || {};
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 80) : row.title;
  const changelog = body.changelog !== undefined ? String(body.changelog).trim().slice(0, 2000) : row.changelog;
  const status = body.status !== undefined ? String(body.status) : row.status;

  if (!['draft', 'beta', 'public'].includes(status)) {
    return res.status(400).json({ error: "Holat noto'g'ri" });
  }
  if (status !== 'draft' && !pageExists(row.version)) {
    return res.status(400).json({
      error: `frontend/versions/${row.version}/index.html fayli serverda topilmadi. Avval kodni deploy qiling.`,
    });
  }

  await db.prepare('UPDATE app_versions SET title = ?, changelog = ?, status = ? WHERE id = ?')
    .run(title, changelog, status, row.id);
  const updated = { ...row, title, changelog, status };

  // draft/beta'ga tushirilsa, ruxsati qolmaganlar avtomatik asosiy versiyaga qaytadi
  await enforceAccess(updated);

  // Hamma uchun ochilganda bir marta push yuboriladi
  if (status === 'public' && row.status !== 'public') {
    push.sendToAll({
      title: `🆕 MTshop V${row.version} chiqdi!`,
      body: "Profils bo'limidan yuklab oling.",
      url: '/index.html#profils',
      tag: `version-${row.version}`,
    }).catch(e => console.error('Versiya push xatosi:', e.message));
  }
  res.json({ ok: true });
});

// Beta testerlar ro'yxatini to'liq almashtirish
router.put('/admin/versions/:id/testers', authMiddleware, adminMiddleware, async (req, res) => {
  const row = await db.prepare('SELECT * FROM app_versions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Versiya topilmadi' });

  let ids = Array.isArray(req.body && req.body.user_ids) ? req.body.user_ids : [];
  ids = [...new Set(ids.map(Number).filter(Boolean))];

  await db.prepare('DELETE FROM app_version_testers WHERE version_id = ?').run(row.id);
  for (const uid of ids) {
    await db.prepare('INSERT OR IGNORE INTO app_version_testers (version_id, user_id) VALUES (?, ?)').run(row.id, uid);
  }
  await enforceAccess(row);
  res.json({ ok: true, count: ids.length });
});

router.delete('/admin/versions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const row = await db.prepare('SELECT * FROM app_versions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Versiya topilmadi' });

  await db.prepare('UPDATE users SET app_version = ? WHERE app_version = ?').run(BASE_VERSION, row.version);
  await db.prepare('DELETE FROM app_version_testers WHERE version_id = ?').run(row.id);
  await db.prepare('DELETE FROM app_versions WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
