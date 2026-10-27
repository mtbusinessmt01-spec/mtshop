const express = require('express');
const { upload, fileToDataUrl } = require('../imageUpload');

const db = require('../db');
const push = require('../push');
const { authMiddleware, adminMiddleware } = require('../auth');
const { isEventItemLocked, parseEventId, eventRibbon } = require('../eventUtil');

const router = express.Router();

function isTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

// Daily Case qoidalari
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;          // ochgandan 24 soat keyin yana ochiladi
const DAILY_MIN_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000; // yangi akkaunt 3 kundan keyin ulanadi

// SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) yoki ISO qatorini ms ga o'giradi
function parseDbUtc(s) {
  if (!s) return NaN;
  const str = String(s);
  return new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z').getTime();
}

async function getCaseWithItems(caseId) {
  const c = await db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!c) return null;
  const items = await db.prepare(`
    SELECT ci.*, g.name as gift_name, g.image_url as gift_image_url
    FROM case_items ci
    LEFT JOIN gifts g ON g.id = ci.gift_id
    WHERE ci.case_id = ?
  `).all(caseId);
  return { ...c, items };
}

// ---------- ADMIN: Case CRUD ----------

router.get('/admin/cases', authMiddleware, adminMiddleware, async (req, res) => {
  const cases = await db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all();
  res.json(await Promise.all(cases.map(c => getCaseWithItems(c.id))));
});

router.get('/admin/cases/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const c = await getCaseWithItems(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case topilmadi' });
  res.json(c);
});

// items: JSON string -> [{item_type:'gift'|'coin', gift_id, coin_amount, chance_percent}]
router.post('/admin/cases', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name } = req.body;
  const isDaily = isTruthy(req.body.is_daily);
  const price = isDaily ? '0' : req.body.price; // kunlik case bepul
  let items;
  try { items = JSON.parse(req.body.items || '[]'); } catch { items = []; }

  if (!name || !price) return res.status(400).json({ error: "Nomi va narxi kerak" });
  if (!items.length) return res.status(400).json({ error: "Kamida bitta gift/coin qo'shish kerak" });

  const imageUrl = fileToDataUrl(req.file);

  let eventId = await parseEventId(req.body.event_id);
  if (eventId === undefined) eventId = null;

  const tx = db.transaction(async () => {
    const result = await db.prepare(
      'INSERT INTO cases (name, image_url, price, event_id, is_daily) VALUES (?, ?, ?, ?, ?)'
    ).run(name, imageUrl, parseFloat(price), eventId, isDaily ? 1 : 0);
    const caseId = result.lastInsertRowid;
    // Bir vaqtda faqat bitta daily case bo'ladi
    if (isDaily) await db.prepare('UPDATE cases SET is_daily = 0 WHERE id != ?').run(caseId);

    const insertItem = db.prepare(
      'INSERT INTO case_items (case_id, item_type, gift_id, coin_amount, chance_percent) VALUES (?, ?, ?, ?, ?)'
    );
    for (const it of items) {
      await insertItem.run(
        caseId,
        it.item_type,
        it.item_type === 'gift' ? it.gift_id : null,
        it.item_type === 'coin' ? parseFloat(it.coin_amount) : null,
        parseFloat(it.chance_percent)
      );
    }
    return caseId;
  });

  const caseId = await tx();
  res.json(await getCaseWithItems(caseId));
});

router.put('/admin/cases/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const existing = await db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Case topilmadi' });

  const { name } = req.body;
  const isDaily = req.body.is_daily === undefined ? !!existing.is_daily : isTruthy(req.body.is_daily);
  const price = isDaily ? '0' : req.body.price;
  let items = null;
  if (req.body.items !== undefined) {
    try { items = JSON.parse(req.body.items); } catch { items = null; }
  }
  const imageUrl = req.file ? fileToDataUrl(req.file) : existing.image_url;

  let eventId = await parseEventId(req.body.event_id);
  if (eventId === undefined) eventId = existing.event_id ?? null;

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE cases SET name = ?, price = ?, image_url = ?, event_id = ?, is_daily = ? WHERE id = ?')
      .run(name || existing.name, price ? parseFloat(price) : existing.price, imageUrl, eventId, isDaily ? 1 : 0, id);
    // Bir vaqtda faqat bitta daily case bo'ladi
    if (isDaily) await db.prepare('UPDATE cases SET is_daily = 0 WHERE id != ?').run(id);

    if (items) {
      await db.prepare('DELETE FROM case_items WHERE case_id = ?').run(id);
      const insertItem = db.prepare(
        'INSERT INTO case_items (case_id, item_type, gift_id, coin_amount, chance_percent) VALUES (?, ?, ?, ?, ?)'
      );
      for (const it of items) {
        await insertItem.run(
          id,
          it.item_type,
          it.item_type === 'gift' ? it.gift_id : null,
          it.item_type === 'coin' ? parseFloat(it.coin_amount) : null,
          parseFloat(it.chance_percent)
        );
      }
    }
  });
  await tx();

  res.json(await getCaseWithItems(id));
});

router.delete('/admin/cases/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const tx = db.transaction(async () => {
    // Foydalanuvchilar inventaridagi shu case'ni ham tozalaymiz
    await db.prepare('DELETE FROM user_cases WHERE case_id = ?').run(req.params.id);
    // Transfer tarixida bu case'ga bo'lgan bog'lanishni yo'qotamiz (tarix o'zi qoladi)
    await db.prepare('UPDATE transfers SET case_id = NULL WHERE case_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM case_items WHERE case_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
  });
  await tx();
  res.json({ ok: true });
});

// ---------- FOYDALANUVCHI: Shop, Buy, Inventory, Open ----------

router.get('/cases', authMiddleware, async (req, res) => {
  // Event'i hali boshlanmagan case'lar Shopda ko'rinmaydi
  const nowIso = new Date().toISOString();
  const cases = await db.prepare(`
    SELECT c.*, e.name AS event_name, e.ribbon_color AS event_ribbon_color,
           e.starts_at AS event_starts_at, e.ends_at AS event_ends_at
    FROM cases c
    LEFT JOIN events e ON e.id = c.event_id
    WHERE c.is_daily = 0 AND (c.event_id IS NULL OR e.id IS NULL OR e.starts_at <= ?)
    ORDER BY c.price ASC
  `).all(nowIso);
  // Event davom etayotgan bo'lsagina lenta chiqadi
  res.json(await Promise.all(cases.map(async c => ({
    ...(await getCaseWithItems(c.id)),
    event_ribbon: eventRibbon(c, nowIso),
  }))));
});

router.post('/cases/:id/buy', authMiddleware, async (req, res) => {
  const c = await db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case topilmadi' });
  if (c.is_daily) return res.status(400).json({ error: 'Bu case sotilmaydi — har kuni bepul ochiladi' });
  if (await isEventItemLocked(c.event_id)) {
    return res.status(400).json({ error: 'Bu case event boshlangandan keyin sotuvga chiqadi' });
  }

  // Balansni tekshirish va yechish bitta atomik SQL buyrug'ida bajariladi —
  // shu bilan bir vaqtda bir nechta so'rov kelsa ham (masalan tugma tez-tez bosilsa),
  // balans hech qachon manfiy bo'lib ketmaydi.
  const deductResult = await db.prepare(
    'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
  ).run(c.price, req.user.id, c.price);

  if (!deductResult.changes) {
    return res.status(400).json({ error: 'Coin yetarli emas' });
  }

  await db.prepare('INSERT INTO user_cases (user_id, case_id) VALUES (?, ?)').run(req.user.id, c.id);

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

router.get('/inventory/cases', authMiddleware, async (req, res) => {
  const items = await db.prepare(`
    SELECT uc.id as inventory_id, uc.acquired_at, c.id as case_id, c.name, c.image_url, c.price
    FROM user_cases uc JOIN cases c ON c.id = uc.case_id
    WHERE uc.user_id = ?
    ORDER BY uc.acquired_at DESC
  `).all(req.user.id);
  res.json(items);
});

// Vaznlangan tasodifiy tanlov (chance_percent asosida)
function pickWeightedItem(items) {
  const total = items.reduce((sum, it) => sum + it.chance_percent, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.chance_percent;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

router.post('/inventory/cases/:inventoryId/open', authMiddleware, async (req, res) => {
  const userCase = await db.prepare(
    'SELECT * FROM user_cases WHERE id = ? AND user_id = ?'
  ).get(req.params.inventoryId, req.user.id);
  if (!userCase) return res.status(404).json({ error: 'Topilmadi' });

  const items = await db.prepare('SELECT * FROM case_items WHERE case_id = ?').all(userCase.case_id);
  if (!items.length) return res.status(400).json({ error: "Case bo'sh" });

  const won = pickWeightedItem(items);

  // Haqiqiy tranzaksiya: case allaqachon ochilgan bo'lsa (tez-tez bosish / ikki qurilma) mukofot ikki marta berilmaydi
  try {
    await db.withTx(async (tx) => {
      const del = await tx.prepare('DELETE FROM user_cases WHERE id = ? AND user_id = ?').run(userCase.id, req.user.id);
      if (!del.changes) throw new Error('ALREADY_OPENED');

      if (won.item_type === 'coin') {
        await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?')
          .run(won.coin_amount, req.user.id);
      } else {
        const gift = await tx.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
        await tx.prepare('INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)')
          .run(req.user.id, won.gift_id, gift ? gift.price : 0);
      }
    });
  } catch (e) {
    if (e.message === 'ALREADY_OPENED') return res.status(409).json({ error: 'Bu case allaqachon ochilgan' });
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);

  let wonDisplay;
  if (won.item_type === 'coin') {
    wonDisplay = { item_type: 'coin', coin_amount: won.coin_amount };
  } else {
    const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
    wonDisplay = { item_type: 'gift', gift_id: won.gift_id, name: gift?.name, image_url: gift?.image_url, rarity: gift?.rarity || 'common' };

    // Noyob (rare) yoki afsonaviy (legendary) gift chiqsa push yuboramiz.
    // Case ochilish animatsiyasi (~3 soniya) tugagach kelishi uchun biroz kechiktiramiz (spoiler bo'lmasligi uchun).
    if (gift && (gift.rarity === 'rare' || gift.rarity === 'legendary')) {
      const legendary = gift.rarity === 'legendary';
      setTimeout(() => {
        push.notifyUser(req.user.id, {
          title: legendary ? '🌟 AFSONAVIY gift yutdingiz!' : '💎 Noyob gift yutdingiz!',
          body: `Case'dan "${gift.name}" chiqdi! Inventoringizni tekshiring.`,
          url: '/index.html',
          tag: 'rare-gift',
          category: 'gifts',
        });
      }, 4000);
    }
  }

  res.json({ ok: true, won: wonDisplay, coin_balance: updatedUser.coin_balance });
});

// ---------- DAILY CASE ----------

async function getDailyCase() {
  const c = await db.prepare('SELECT id FROM cases WHERE is_daily = 1 ORDER BY id DESC LIMIT 1').get();
  return c ? await getCaseWithItems(c.id) : null;
}

// Holat: foydalanuvchi uchun kunlik case ochilishi mumkinmi
router.get('/daily-case', authMiddleware, async (req, res) => {
  const nowMs = Date.now();
  const c = await getDailyCase();
  if (!c) return res.json({ case: null, server_now: nowMs });

  const user = await db.prepare('SELECT created_at, is_admin FROM users WHERE id = ?').get(req.user.id);
  const claim = await db.prepare('SELECT last_opened_at FROM daily_case_claims WHERE user_id = ?').get(req.user.id);

  const unlockAt = parseDbUtc(user.created_at) + DAILY_MIN_ACCOUNT_AGE_MS;
  const nextOpenAt = claim ? new Date(claim.last_opened_at).getTime() + DAILY_COOLDOWN_MS : 0;

  let status = 'ready';
  if (!user.is_admin && nowMs < unlockAt) status = 'locked_new';
  else if (nowMs < nextOpenAt) status = 'cooldown';

  res.json({
    case: { id: c.id, name: c.name, image_url: c.image_url, items: c.items },
    status,
    unlock_at: unlockAt,
    next_open_at: nextOpenAt,
    server_now: nowMs,
  });
});

// Ochish. Cooldown tekshiruvi va mukofot BITTA tranzaksiyada: tez-tez bosish yoki ikki qurilmadan
// bir vaqtda ochishda faqat bitta so'rov o'tadi (daily_case_claims.user_id — PRIMARY KEY).
router.post('/daily-case/open', authMiddleware, async (req, res) => {
  const c = await getDailyCase();
  if (!c) return res.status(404).json({ error: 'Kunlik case hozircha yo\'q' });
  if (!c.items.length) return res.status(400).json({ error: "Case bo'sh" });

  const nowMs = Date.now();
  const user = await db.prepare('SELECT created_at, is_admin FROM users WHERE id = ?').get(req.user.id);
  const unlockAt = parseDbUtc(user.created_at) + DAILY_MIN_ACCOUNT_AGE_MS;
  if (!user.is_admin && nowMs < unlockAt) {
    return res.status(403).json({ error: 'Yangi akkaunt kunlik case\'ga 3 kundan keyin ulanadi', unlock_at: unlockAt });
  }

  const won = pickWeightedItem(c.items);
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - DAILY_COOLDOWN_MS).toISOString();

  try {
    await db.withTx(async (tx) => {
      // Atomik "band qilish": qator yo'q bo'lsa qo'shiladi, 24 soat o'tgan bo'lsa yangilanadi, aks holda 0 ta qator o'zgaradi
      const claim = await tx.prepare(`
        INSERT INTO daily_case_claims (user_id, last_opened_at) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET last_opened_at = excluded.last_opened_at
        WHERE daily_case_claims.last_opened_at <= ?
      `).run(req.user.id, nowIso, cutoffIso);
      if (!claim.changes) throw new Error('DAILY_COOLDOWN');

      if (won.item_type === 'coin') {
        // 2 xonagacha yaxlitlaymiz: 0.1 + 0.2 kabi qo'shishlarda kasr xatolari yig'ilmasin
        await tx.prepare('UPDATE users SET coin_balance = ROUND(coin_balance + ?, 2) WHERE id = ?')
          .run(won.coin_amount, req.user.id);
      } else {
        const gift = await tx.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
        await tx.prepare('INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, ?)')
          .run(req.user.id, won.gift_id, gift ? gift.price : 0);
      }

      await tx.prepare(
        'INSERT INTO daily_case_opens (user_id, case_id, opened_at, item_type, coin_amount, gift_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(req.user.id, c.id, nowIso, won.item_type,
        won.item_type === 'coin' ? won.coin_amount : null,
        won.item_type === 'gift' ? won.gift_id : null);
    });
  } catch (e) {
    if (e.message === 'DAILY_COOLDOWN') {
      const claim = await db.prepare('SELECT last_opened_at FROM daily_case_claims WHERE user_id = ?').get(req.user.id);
      const nextOpenAt = claim ? new Date(claim.last_opened_at).getTime() + DAILY_COOLDOWN_MS : nowMs + DAILY_COOLDOWN_MS;
      return res.status(429).json({ error: 'Kunlik case hali tayyor emas', next_open_at: nextOpenAt });
    }
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);

  let wonDisplay;
  if (won.item_type === 'coin') {
    wonDisplay = { item_type: 'coin', coin_amount: won.coin_amount };
  } else {
    const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(won.gift_id);
    wonDisplay = { item_type: 'gift', gift_id: won.gift_id, name: gift?.name, image_url: gift?.image_url, rarity: gift?.rarity || 'common' };
    // Daily Case bildirishnoma yubormaydi (egasining qarori)
  }

  res.json({
    ok: true,
    won: wonDisplay,
    coin_balance: updatedUser.coin_balance,
    next_open_at: nowMs + DAILY_COOLDOWN_MS,
    pool: c.items, // ochilish animatsiyasi uchun
  });
});

// Admin statistikasi
router.get('/admin/daily-case/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const c = await getDailyCase();
  const since24 = new Date(Date.now() - DAILY_COOLDOWN_MS).toISOString();
  const total = await db.prepare(`
    SELECT COUNT(*) AS opens, COUNT(DISTINCT user_id) AS users,
           COALESCE(SUM(CASE WHEN item_type = 'coin' THEN coin_amount ELSE 0 END), 0) AS coins,
           COALESCE(SUM(CASE WHEN item_type = 'gift' THEN 1 ELSE 0 END), 0) AS gifts,
           COALESCE(SUM(CASE WHEN item_type = 'coin' AND coin_amount = 0 THEN 1 ELSE 0 END), 0) AS empty
    FROM daily_case_opens
  `).get();
  const last24 = await db.prepare(`
    SELECT COUNT(*) AS opens,
           COALESCE(SUM(CASE WHEN item_type = 'coin' THEN coin_amount ELSE 0 END), 0) AS coins
    FROM daily_case_opens WHERE opened_at >= ?
  `).get(since24);
  res.json({
    case: c ? { id: c.id, name: c.name } : null,
    last_24h: { opens: last24.opens, coins: Math.round(last24.coins * 100) / 100 },
    total: { opens: total.opens, users: total.users, coins: Math.round(total.coins * 100) / 100, gifts: total.gifts, empty: total.empty },
  });
});

module.exports = router;
