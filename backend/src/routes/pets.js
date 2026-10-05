const express = require('express');
const { upload, fileToDataUrl } = require('../imageUpload');

const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const R = require('../petRules');   // barcha pet qoidalari (muddatlar, narxlar, bonus) shu yerda

const MAX_PETS_PER_USER = 2;

// ---------- ADMIN: Pet turlari CRUD ----------

router.get('/admin/pet-types', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM pet_types ORDER BY created_at DESC').all());
});

router.post('/admin/pet-types', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { name, price, coin_per_3h, xp_to_feed_full, xp_per_level, stock, unlimited } = req.body || {};
  if (!name || !price || !coin_per_3h || !xp_to_feed_full || !xp_per_level) {
    return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
  }
  const imageUrl = fileToDataUrl(req.file);
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
  const imageUrl = req.file ? fileToDataUrl(req.file) : existing.image_url;
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
  const tx = db.transaction(async () => {
    // Foydalanuvchilarning shu turdagi pet'larini ham tozalaymiz
    await db.prepare('DELETE FROM user_pets WHERE pet_type_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM pet_types WHERE id = ?').run(req.params.id);
  });
  await tx();
  res.json({ ok: true });
});

// ---------- Holatni hisoblash (ovqatlanish, kasallik, o'lim, daromad) ----------
// Muddatlar: 8 soat — och (daromad 50%), 24 soat — kasal (daromad yo'q), 72 soat — o'ladi.
// O'lgan pet 7 kun ichida tiriltirilishi mumkin, keyin avtomatik o'chadi (null qaytaradi).

async function refreshPet(pet, petType) {
  const now = Date.now();

  if (pet.status === 'dead') {
    let diedMs = R.parseTs(pet.died_at);
    if (Number.isNaN(diedMs)) {
      // died_at yo'q (eski) o'lgan pet'lar: tiriltirish muddati shu paytdan boshlanadi
      diedMs = now;
      await db.prepare('UPDATE user_pets SET died_at = ? WHERE id = ? AND died_at IS NULL')
        .run(new Date(diedMs).toISOString(), pet.id);
    }
    if (now - diedMs >= R.REVIVE_WINDOW_MS) {
      await db.prepare("DELETE FROM user_pets WHERE id = ? AND status = 'dead'").run(pet.id);
      return null;
    }
    return { ...pet, died_at: new Date(diedMs).toISOString() };
  }

  const lastFedMs = R.parseTs(pet.last_fed_at);
  const lastIncomeMs = R.parseTs(pet.last_income_at);
  const stage = R.stageFor(now - lastFedMs);
  const status = stage === 'dead' ? 'dead' : stage === 'sick' ? 'sick' : 'healthy';

  // Har 3 soatlik interval o'sha paytdagi ochlik bosqichi va LV bonusi bilan hisoblanadi
  const { coin, advancedMs } = R.accrueIncome({
    lastFedMs, lastIncomeMs, nowMs: now, coinPer3h: petType.coin_per_3h || 0, level: pet.level,
  });
  // Kasal/o'lgan bo'lsa sanoqni hozirga tenglaymiz (davolangach shundan davom etadi)
  const newIncomeMs = status === 'healthy' ? advancedMs : now;
  const newIncomeIso = new Date(newIncomeMs).toISOString();
  const diedAt = status === 'dead' ? new Date(lastFedMs + R.DEATH_AFTER_MS).toISOString() : null;

  const changed = status !== pet.status || coin > 0 || newIncomeMs !== lastIncomeMs;
  if (changed) {
    // last_income_at bo'yicha shartli yangilash: ikki parallel so'rov bir xil coin'ni ikki marta qo'sha olmaydi
    const r = await db.prepare(
      'UPDATE user_pets SET status = ?, last_income_at = ?, died_at = ? WHERE id = ? AND last_income_at = ?'
    ).run(status, newIncomeIso, diedAt, pet.id, pet.last_income_at);
    if (r.changes && coin > 0) {
      await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(coin, pet.user_id);
    }
  }

  return { ...pet, status, last_income_at: newIncomeIso, died_at: diedAt };
}

async function refreshAllUserPets(userId) {
  const pets = await db.prepare('SELECT * FROM user_pets WHERE user_id = ?').all(userId);
  const allTypes = await db.prepare('SELECT * FROM pet_types').all();
  const types = {};
  allTypes.forEach(t => types[t.id] = t);
  const refreshed = await Promise.all(pets.map(p => refreshPet(p, types[p.pet_type_id] || {})));
  return refreshed.filter(Boolean);
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
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

router.get('/pets/my', authMiddleware, async (req, res) => {
  const refreshed = await refreshAllUserPets(req.user.id);
  const allTypes = await db.prepare('SELECT * FROM pet_types').all();
  const types = {};
  allTypes.forEach(t => types[t.id] = t);

  const now = Date.now();
  const hoursLeft = (ms) => Math.max(0, Math.round((ms / R.HOUR_MS) * 10) / 10);

  const result = refreshed.map(p => {
    const t = types[p.pet_type_id] || {};
    const elapsed = now - R.parseTs(p.last_fed_at);
    const stage = p.status === 'dead' ? 'dead' : R.stageFor(elapsed);   // full | hungry | sick | dead
    const reviveMsLeft = p.status === 'dead' ? R.REVIVE_WINDOW_MS - (now - R.parseTs(p.died_at)) : 0;

    return {
      ...p,
      pet_name: t.name,
      pet_image_url: t.image_url,
      coin_per_3h: t.coin_per_3h,
      xp_per_level: t.xp_per_level,
      required_feed_xp: R.round2(R.requiredFeedXp(t, p.level)),
      next_level_required_feed_xp: R.round2(R.requiredFeedXp(t, p.level + 1)),
      stage,
      hours_until_hungry: stage === 'full' ? hoursLeft(R.HUNGRY_AFTER_MS - elapsed) : 0,
      hours_until_sick: (stage === 'full' || stage === 'hungry') ? hoursLeft(R.SICK_AFTER_MS - elapsed) : 0,
      hours_until_death: p.status !== 'dead' ? hoursLeft(R.DEATH_AFTER_MS - elapsed) : 0,
      level_bonus_percent: Math.round(R.levelBonus(p.level) * 100),
      bonus_cap_level: R.BONUS_CAP_LEVEL,
      income_now: R.incomePer3h(t.coin_per_3h || 0, p.level, stage),   // hozir 3 soatda tushadigan coin
      heal_cost: R.healCost(t.price),
      revive_cost: R.reviveCost(t.price),
      revive_hours_left: hoursLeft(reviveMsLeft),
      sell_price: R.sellPrice(t.price, p.level),
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

// Ovqatlantirish: bir xil turdagi giftdan bir nechtasi beriladi, gift narxi/10 * miqdor = XP.
// Proporsional: XP to'yish uchun kerakli miqdorning qancha qismini bersa, ochlik vaqti shuncha qisqaradi.
router.post('/pets/:id/feed', authMiddleware, async (req, res) => {
  const { gift_id, quantity } = req.body || {};
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  let pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(pet.pet_type_id);
  if (!petType) return res.status(404).json({ error: 'Pet turi topilmadi' });

  // Avval eski holat bo'yicha daromadni hisoblab qo'yamiz, so'ng ovqatlantiramiz
  pet = await refreshPet(pet, petType);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  if (pet.status === 'dead') return res.status(400).json({ error: "Bu pet o'lgan. Uni tiriltirishingiz mumkin." });

  const giftRows = await db.prepare(
    'SELECT * FROM user_gifts WHERE user_id = ? AND gift_id = ? AND trade_id IS NULL ORDER BY id LIMIT ?'
  ).all(req.user.id, gift_id, qty);
  if (giftRows.length < qty) {
    return res.status(400).json({ error: `Sizda faqat ${giftRows.length} dona shu gift bor` });
  }

  const gift = await db.prepare('SELECT * FROM gifts WHERE id = ?').get(gift_id);

  const xpGained = Math.round((gift.price / 10) * qty * 100) / 100;
  const nowMs = Date.now();
  const elapsedMs = nowMs - R.parseTs(pet.last_fed_at);
  const { fraction, newElapsedMs } = R.applyFeed({
    elapsedMs, xpGained, requiredXp: R.requiredFeedXp(petType, pet.level),
  });
  const newLastFed = new Date(nowMs - newElapsedMs).toISOString();
  const newStatus = newElapsedMs >= R.SICK_AFTER_MS ? 'sick' : 'healthy';

  let newXp = pet.xp + xpGained;
  let newLevel = pet.level;
  while (newXp >= petType.xp_per_level) {
    newXp -= petType.xp_per_level;
    newLevel += 1;
  }

  // Haqiqiy tranzaksiya: giftlar faqat egasida va Trade'da band bo'lmasa sarflanadi
  try {
    await db.withTx(async (tx) => {
      for (const g of giftRows) {
        const d = await tx.prepare('DELETE FROM user_gifts WHERE id = ? AND user_id = ? AND trade_id IS NULL').run(g.id, req.user.id);
        if (!d.changes) throw new Error('GIFT_UNAVAILABLE');
      }
      await tx.prepare(`
        UPDATE user_pets SET xp = ?, level = ?, status = ?, last_fed_at = ? WHERE id = ?
      `).run(newXp, newLevel, newStatus, newLastFed, pet.id);
    });
  } catch (e) {
    if (e.message === 'GIFT_UNAVAILABLE') return res.status(409).json({ error: "Giftlar band yoki allaqachon ishlatilgan. Qayta urinib ko'ring." });
    throw e;
  }

  res.json({
    ok: true,
    xp_gained: xpGained,
    satisfied_hunger: fraction >= 1,
    hunger_restored_percent: Math.round(fraction * 100),
    status: newStatus,
    new_level: newLevel,
    leveled_up: newLevel > pet.level,
  });
});

// Davolash (kasal bo'lsa): narxi pet narxining 10%, kamida 25 coin
router.post('/pets/:id/heal', authMiddleware, async (req, res) => {
  let pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(pet.pet_type_id);
  if (!petType) return res.status(404).json({ error: 'Pet turi topilmadi' });

  pet = await refreshPet(pet, petType);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  if (pet.status === 'dead') return res.status(400).json({ error: "Pet o'lgan. Uni tiriltirishingiz mumkin." });
  if (pet.status !== 'sick') return res.status(400).json({ error: 'Pet kasal emas' });

  const cost = R.healCost(petType.price);
  const nowIso = new Date().toISOString();

  // Coin yechish va pet'ni tiklash — bitta tranzaksiyada (ikki marta bosilsa ham bir marta yechiladi)
  try {
    await db.withTx(async (tx) => {
      const d = await tx.prepare(
        'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
      ).run(cost, req.user.id, cost);
      if (!d.changes) throw new Error('NO_COIN');
      // Davolash pet'ni to'ydirilgan holatga ham qaytaradi (soat qayta boshlanadi)
      const u = await tx.prepare(
        "UPDATE user_pets SET status = 'healthy', last_fed_at = ?, last_income_at = ?, died_at = NULL WHERE id = ? AND user_id = ? AND status = 'sick'"
      ).run(nowIso, nowIso, pet.id, req.user.id);
      if (!u.changes) throw new Error('NOT_SICK');
    });
  } catch (e) {
    if (e.message === 'NO_COIN') return res.status(400).json({ error: `Coin yetarli emas (kerak: ${cost})` });
    if (e.message === 'NOT_SICK') return res.status(400).json({ error: 'Pet kasal emas' });
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, cost, coin_balance: updatedUser.coin_balance });
});

// Tiriltirish (o'lgandan keyin 7 kun ichida): pet narxining 50%. LV va XP saqlanadi.
router.post('/pets/:id/revive', authMiddleware, async (req, res) => {
  let pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(pet.pet_type_id);
  if (!petType) return res.status(404).json({ error: 'Pet turi topilmadi' });

  pet = await refreshPet(pet, petType);
  if (!pet) return res.status(404).json({ error: "Tiriltirish muddati (7 kun) o'tgan, pet o'chirilgan" });
  if (pet.status !== 'dead') return res.status(400).json({ error: "Pet o'lmagan" });

  const aliveRow = await db.prepare("SELECT COUNT(*) as c FROM user_pets WHERE user_id = ? AND status != 'dead'").get(req.user.id);
  if (aliveRow.c >= MAX_PETS_PER_USER) {
    return res.status(400).json({ error: `Avval joy bo'shating: maksimum ${MAX_PETS_PER_USER} ta tirik pet bo'lishi mumkin` });
  }

  const cost = R.reviveCost(petType.price);
  const nowIso = new Date().toISOString();

  try {
    await db.withTx(async (tx) => {
      const d = await tx.prepare(
        'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
      ).run(cost, req.user.id, cost);
      if (!d.changes) throw new Error('NO_COIN');
      const u = await tx.prepare(
        "UPDATE user_pets SET status = 'healthy', last_fed_at = ?, last_income_at = ?, died_at = NULL WHERE id = ? AND user_id = ? AND status = 'dead'"
      ).run(nowIso, nowIso, pet.id, req.user.id);
      if (!u.changes) throw new Error('NOT_DEAD');
    });
  } catch (e) {
    if (e.message === 'NO_COIN') return res.status(400).json({ error: `Coin yetarli emas (kerak: ${cost})` });
    if (e.message === 'NOT_DEAD') return res.status(400).json({ error: "Pet o'lmagan" });
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, cost, coin_balance: updatedUser.coin_balance });
});

// Saytga qayta sotish: narx LV ga bog'liq (LV 17 dan keyin oshib boradi). O'lgan pet sotilmaydi.
router.post('/pets/:id/sell', authMiddleware, async (req, res) => {
  let pet = await db.prepare('SELECT * FROM user_pets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  const petType = await db.prepare('SELECT * FROM pet_types WHERE id = ?').get(pet.pet_type_id);
  if (!petType) return res.status(404).json({ error: 'Pet turi topilmadi' });

  pet = await refreshPet(pet, petType);
  if (!pet) return res.status(404).json({ error: 'Pet topilmadi' });
  if (pet.status === 'dead') return res.status(400).json({ error: "O'lgan petni sotib bo'lmaydi. Avval tiriltiring." });

  const price = R.sellPrice(petType.price, pet.level);

  try {
    await db.withTx(async (tx) => {
      const d = await tx.prepare("DELETE FROM user_pets WHERE id = ? AND user_id = ? AND status != 'dead'").run(pet.id, req.user.id);
      if (!d.changes) throw new Error('GONE');
      await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(price, req.user.id);
    });
  } catch (e) {
    if (e.message === 'GONE') return res.status(409).json({ error: 'Pet allaqachon sotilgan yoki topilmadi' });
    throw e;
  }

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, sold_for: price, coin_balance: updatedUser.coin_balance });
});

module.exports = router;
