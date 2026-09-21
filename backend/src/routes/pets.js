const express = require('express');
<<<<<<< HEAD
const { upload, fileToDataUrl } = require('../imageUpload');
=======
const multer = require('multer');
const path = require('path');
const fs = require('fs');
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

<<<<<<< HEAD
=======
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'pets');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `pet_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2
const MAX_PETS_PER_USER = 2;
const HOUR_MS = 60 * 60 * 1000;
const FEED_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 soat
const SICK_AFTER_MS = 24 * 60 * 60 * 1000;     // 24 soat
const DEATH_AFTER_MS = 36 * 60 * 60 * 1000;    // 36 soat
const INCOME_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 soat
const HEAL_COST = 25;

// ---------- ADMIN: Pet turlari CRUD ----------

router.get('/admin/pet-types', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM pet_types ORDER BY created_at DESC').all());
});

router.post('/admin/pet-types', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name, price, coin_per_3h, xp_to_feed_full, xp_per_level, stock, unlimited } = req.body || {};
  if (!name || !price || !coin_per_3h || !xp_to_feed_full || !xp_per_level) {
    return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
  }
<<<<<<< HEAD
  const imageUrl = fileToDataUrl(req.file);
=======
  const imageUrl = req.file ? `/uploads/pets/${req.file.filename}` : null;
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2
  const stockVal = (unlimited === 'true' || unlimited === true) ? null : parseInt(stock, 10) || 0;

  const result = await db.prepare(`
    INSERT INTO pet_types (name, image_url, price, coin_per_3h, xp_to_feed_full, xp_per_level, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, imageUrl, parseFloat(price), parseFloat(coin_per_3h), parseFloat(xp_to_feed_full), parseFloat(xp_per_level), stockVal);

  res.json(await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/admin/pet-types/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const existing = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });

  const { name, price, coin_per_3h, xp_to_feed_full, xp_per_level, stock, unlimited } = req.body || {};
<<<<<<< HEAD
  const imageUrl = req.file ? fileToDataUrl(req.file) : existing.image_url;
=======
  const imageUrl = req.file ? `/uploads/pets/${req.file.filename}` : existing.image_url;
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2
  const stockVal = (unlimited === 'true' || unlimited === true)
    ? null
    : (stock !== undefined ? parseInt(stock, 10) : existing.stock);

  await db.prepare(`
    UPDATE pet_types SET name=?, image_url=?, price=?, coin_per_3h=?, xp_to_feed_full=?, xp_per_level=?, stock=? WHERE id=?
  `).run(
    name || existing.name,
    imageUrl,
    price !== undefined ? parseFloat(price) : existing.price,
    coin_per_3h !== undefined ? parseFloat(coin_per_3h) : existing.coin_per_3h,
    xp_to_feed_full !== undefined ? parseFloat(xp_to_feed_full) : existing.xp_to_feed_full,
    xp_per_level !== undefined ? parseFloat(xp_per_level) : existing.xp_per_level,
    stockVal,
    id
  );
  res.json(await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(id));
});

router.delete('/admin/pet-types/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await db.prepare('DELETE FROM pet_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Holatni hisoblash (ovqatlanish, kasallik, o'lim, daromad) ----------

async function refreshPet(pet, petType) {
  const now = Date.now();
  const lastFed = new Date(pet.last_fed_at).getTime();
  const elapsedSinceFed = now - lastFed;

  let status = pet.status;
  if (status !== 'dead') {
    if (elapsedSinceFed >= DEATH_AFTER_MS) {
      status = 'dead';
    } else if (elapsedSinceFed >= SICK_AFTER_MS) {
      status = 'sick';
    } else {
      status = 'healthy';
    }
  }

  let coinEarned = 0;
  let lastIncome = new Date(pet.last_income_at).getTime();
  if (status === 'healthy') {
    const intervals = Math.floor((now - lastIncome) / INCOME_INTERVAL_MS);
    if (intervals > 0) {
      coinEarned = Math.round(intervals * petType.coin_per_3h * 100) / 100;
      lastIncome += intervals * INCOME_INTERVAL_MS;
    }
  } else {
    // Kasal/o'lgan bo'lsa daromad to'xtaydi, lekin sanoq keyinroq davom etishi uchun hozirgi vaqtga tenglaymiz
    lastIncome = now;
  }

  const changed = status !== pet.status || coinEarned > 0 || lastIncome !== new Date(pet.last_income_at).getTime();

  if (changed) {
    await db.prepare('UPDATE user_pets SET status = ?, last_income_at = ? WHERE id = ?')
      .run(status, new Date(lastIncome).toISOString(), pet.id);
    if (coinEarned > 0) {
      await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(coinEarned, pet.user_id);
    }
  }

  return { ...pet, status, last_income_at: new Date(lastIncome).toISOString() };
}

async function refreshAllUserPets(userId) {
  const pets = await db.prepare('SELECT * FROM user_pets WHERE user_id = ?').all(userId);
  const allTypes = await db.prepare('SELECT * FROM pet_types').all();
  const types = {};
  allTypes.forEach(t => types[t.id] = t);
  return Promise.all(pets.map(p => refreshPet(p, types[p.pet_type_id] || {})));
}

// ---------- FOYDALANUVCHI ----------

router.get('/pets/types', authMiddleware, async (req, res) => {
  const types = await db.prepare('SELECT * FROM pet_types WHERE stock IS NULL OR stock > 0 ORDER BY price ASC').all();
  res.json(types);
});

router.post('/pets/types/:id/buy', authMiddleware, async (req, res) => {
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(req.params.id);
  if (!petType) return res.status(404).json({ error: 'Pet turi topilmadi' });
  if (petType.stock !== null && petType.stock <= 0) return res.status(400).json({ error: 'Pet tugagan' });

  const ownedCountRow = await db.prepare("SELECT COUNT(*) as c FROM user_pets WHERE user_id = ? AND status != 'dead'").get(req.user.id);
  if (ownedCountRow.c >= MAX_PETS_PER_USER) {
    return res.status(400).json({ error: `Maksimum ${MAX_PETS_PER_USER} ta pet egalik qilishingiz mumkin` });
  }

<<<<<<< HEAD
  const nowIso = new Date().toISOString();

  if (petType.stock !== null) {
    const stockResult = await db.prepare(
      'UPDATE pet_types SET stock = stock - 1 WHERE id = ? AND stock > 0'
    ).run(petType.id);
    if (!stockResult.changes) return res.status(400).json({ error: 'Pet tugagan' });
  }

  const deductResult = await db.prepare(
    'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
  ).run(petType.price, req.user.id, petType.price);

  if (!deductResult.changes) {
    if (petType.stock !== null) {
      await db.prepare('UPDATE pet_types SET stock = stock + 1 WHERE id = ?').run(petType.id);
    }
    return res.status(400).json({ error: 'Coin yetarli emas' });
  }

  await db.prepare(`
    INSERT INTO user_pets (user_id, pet_type_id, level, xp, status, last_fed_at, last_income_at)
    VALUES (?, ?, 1, 0, 'healthy', ?, ?)
  `).run(req.user.id, petType.id, nowIso, nowIso);

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
=======
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.coin_balance < petType.price) return res.status(400).json({ error: 'Coin yetarli emas' });

  const nowIso = new Date().toISOString();
  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(petType.price, user.id);
    if (petType.stock !== null) {
      await db.prepare('UPDATE pet_types SET stock = stock - 1 WHERE id = ?').run(petType.id);
    }
    await db.prepare(`
      INSERT INTO user_pets (user_id, pet_type_id, level, xp, status, last_fed_at, last_income_at)
      VALUES (?, ?, 1, 0, 'healthy', ?, ?)
    `).run(user.id, petType.id, nowIso, nowIso);
  });
  await tx();

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(user.id);
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

router.get('/pets/my', authMiddleware, async (req, res) => {
  const refreshed = await refreshAllUserPets(req.user.id);
  const allTypes = await db.prepare('SELECT * FROM pet_types').all();
  const types = {};
  allTypes.forEach(t => types[t.id] = t);

  const result = refreshed.map(p => {
    const t = types[p.pet_type_id] || {};
    const requiredFeedXp = Math.max((t.xp_to_feed_full || 0) - p.level * 0.2, 0.1);
    const nextRequiredFeedXp = Math.max((t.xp_to_feed_full || 0) - (p.level + 1) * 0.2, 0.1);

    const hoursSinceFed = (Date.now() - new Date(p.last_fed_at).getTime()) / HOUR_MS;
    const hoursUntilSick = Math.max(0, Math.round((SICK_AFTER_MS / HOUR_MS - hoursSinceFed) * 10) / 10);
    const hoursUntilDeath = Math.max(0, Math.round((DEATH_AFTER_MS / HOUR_MS - hoursSinceFed) * 10) / 10);

    return {
      ...p,
      pet_name: t.name,
      pet_image_url: t.image_url,
      coin_per_3h: t.coin_per_3h,
      xp_per_level: t.xp_per_level,
      required_feed_xp: Math.round(requiredFeedXp * 100) / 100,
      next_level_required_feed_xp: Math.round(nextRequiredFeedXp * 100) / 100,
      hours_until_sick: p.status === 'healthy' ? hoursUntilSick : 0,
      hours_until_death: p.status !== 'dead' ? hoursUntilDeath : 0,
    };
  });
  res.json(result);
});

// Petga o'zi ism qo'yishi (faqat o'z peti uchun)
router.put('/pets/:id/name', authMiddleware, async (req, res) => {
  const pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });

  const { name } = req.body || {};
  const trimmed = (name || '').trim().slice(0, 30);
  await db.prepare('UPDATE user_pets SET name = ? WHERE id = ?').run(trimmed || null, pet.id);
  res.json({ ok: true, name: trimmed || null });
});

// Ovqatlantirish: bir xil turdagi giftdan bir nechtasi beriladi, gift narxi/10 * miqdor = XP
router.post('/pets/:id/feed', authMiddleware, async (req, res) => {
  const { gift_id, quantity } = req.body || {};
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  const pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  if (pet.status === 'dead') return res.status(400).json({ error: 'Bu pet o\'lgan' });

  const giftRows = await db.prepare(
    'SELECT * FROM user_gifts WHERE user_id = ? AND gift_id = ? ORDER BY id LIMIT ?'
  ).all(req.user.id, gift_id, qty);
  if (giftRows.length < qty) {
    return res.status(400).json({ error: `Sizda faqat ${giftRows.length} dona shu gift bor` });
  }

  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(gift_id);
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(pet.pet_type_id);

  const xpGained = Math.round((gift.price / 10) * qty * 100) / 100;
  const requiredFeedXp = Math.max(petType.xp_to_feed_full - pet.level * 0.2, 0.1);
  const satisfiesHunger = xpGained >= requiredFeedXp;

  let newXp = pet.xp + xpGained;
  let newLevel = pet.level;
  while (newXp >= petType.xp_per_level) {
    newXp -= petType.xp_per_level;
    newLevel += 1;
  }

  const nowIso = new Date().toISOString();
  const newStatus = satisfiesHunger ? 'healthy' : pet.status;
  const newLastFed = satisfiesHunger ? nowIso : pet.last_fed_at;

  const tx = db.transaction(async () => {
    const del = db.prepare('DELETE FROM user_gifts WHERE id = ?');
    for (const g of giftRows) await del.run(g.id);
    await db.prepare(`
      UPDATE user_pets SET xp = ?, level = ?, status = ?, last_fed_at = ? WHERE id = ?
    `).run(newXp, newLevel, newStatus, newLastFed, pet.id);
  });
  await tx();

  res.json({
    ok: true,
    xp_gained: xpGained,
    satisfied_hunger: satisfiesHunger,
    new_level: newLevel,
    leveled_up: newLevel > pet.level,
  });
});

// Davolash (kasal bo'lsa)
router.post('/pets/:id/heal', authMiddleware, async (req, res) => {
  const pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  if (pet.status !== 'sick') return res.status(400).json({ error: 'Pet kasal emas' });

<<<<<<< HEAD
  const nowIso = new Date().toISOString();

  const deductResult = await db.prepare(
    'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
  ).run(HEAL_COST, req.user.id, HEAL_COST);
  if (!deductResult.changes) return res.status(400).json({ error: 'Coin yetarli emas' });

  // Davolash pet'ni to'ydirilgan holatga ham qaytaradi (soat qayta boshlanadi)
  await db.prepare("UPDATE user_pets SET status = 'healthy', last_fed_at = ?, last_income_at = ? WHERE id = ?")
    .run(nowIso, nowIso, pet.id);
=======
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.coin_balance < HEAL_COST) return res.status(400).json({ error: 'Coin yetarli emas' });

  const nowIso = new Date().toISOString();
  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(HEAL_COST, req.user.id);
    // Davolash pet'ni to'ydirilgan holatga ham qaytaradi (soat qayta boshlanadi)
    await db.prepare("UPDATE user_pets SET status = 'healthy', last_fed_at = ?, last_income_at = ? WHERE id = ?")
      .run(nowIso, nowIso, pet.id);
  });
  await tx();
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

module.exports = router;
