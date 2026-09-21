const express = require('express');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');

const router = express.Router();

const FINE_RATE = 0.12; // kredit summasining 12%
const MAX_FINES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- ADMIN: Kredit turlari CRUD ----------

router.get('/admin/credit-types', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM credit_types ORDER BY created_at DESC').all());
});

router.post('/admin/credit-types', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, min_amount, max_amount, interest_percent, installments_weeks } = req.body || {};
  if (!name || min_amount === undefined || max_amount === undefined || interest_percent === undefined || !installments_weeks) {
    return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
  }
  const result = await db.prepare(`
    INSERT INTO credit_types (name, min_amount, max_amount, interest_percent, installments_weeks)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, parseFloat(min_amount), parseFloat(max_amount), parseFloat(interest_percent), parseInt(installments_weeks, 10));
  res.json(await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/admin/credit-types/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const existing = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });
  const { name, min_amount, max_amount, interest_percent, installments_weeks } = req.body || {};
  await db.prepare(`
    UPDATE credit_types SET name=?, min_amount=?, max_amount=?, interest_percent=?, installments_weeks=? WHERE id=?
  `).run(
    name ?? existing.name,
    min_amount !== undefined ? parseFloat(min_amount) : existing.min_amount,
    max_amount !== undefined ? parseFloat(max_amount) : existing.max_amount,
    interest_percent !== undefined ? parseFloat(interest_percent) : existing.interest_percent,
    installments_weeks !== undefined ? parseInt(installments_weeks, 10) : existing.installments_weeks,
    id
  );
  res.json(await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(id));
});

router.delete('/admin/credit-types/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await db.prepare('DELETE FROM credit_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Jarima mexanizmi ----------
// Har chaqirilganda foydalanuvchining faol kreditlarini tekshirib,
// muddati o'tgan to'lovlar uchun 12% jarima qo'shadi va 3 martadan keyin bloklaydi.
async function applyOverdueFines(userId) {
  const activeCredits = await db.prepare(
    "SELECT * FROM user_credits WHERE user_id = ? AND status = 'active'"
  ).all(userId);

  const now = Date.now();

  for (const credit of activeCredits) {
    let next = new Date(credit.next_payment_at).getTime();
    let fineCount = credit.fine_count;
    let remaining = credit.remaining_amount;
    let changed = false;

    while (now > next && fineCount < MAX_FINES && remaining > 0) {
      const fine = Math.round(credit.principal_amount * FINE_RATE * 100) / 100;
      remaining += fine;
      fineCount += 1;
      next += WEEK_MS;
      changed = true;
    }

    if (changed) {
      const newStatus = fineCount >= MAX_FINES ? 'defaulted' : 'active';
      await db.prepare(`
        UPDATE user_credits SET remaining_amount = ?, fine_count = ?, next_payment_at = ?, status = ?
        WHERE id = ?
      `).run(remaining, fineCount, new Date(next).toISOString(), newStatus, credit.id);

      if (fineCount >= MAX_FINES) {
        await db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(userId);
      }
    }
  }
}

// ---------- FOYDALANUVCHI ----------

// Mavjud kredit turlari
router.get('/credits/types', authMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM credit_types ORDER BY min_amount ASC').all());
});

// Kredit olish
router.post('/credits/take', authMiddleware, async (req, res) => {
  const { credit_type_id, amount } = req.body || {};
  const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(credit_type_id);
  if (!type) return res.status(404).json({ error: 'Kredit turi topilmadi' });

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < type.min_amount || amt > type.max_amount) {
    return res.status(400).json({ error: `Miqdor ${type.min_amount} - ${type.max_amount} orasida bo'lishi kerak` });
  }

  const existingActive = await db.prepare(
    "SELECT id FROM user_credits WHERE user_id = ? AND status = 'active'"
  ).get(req.user.id);
  if (existingActive) return res.status(400).json({ error: "Sizda allaqachon faol krediting bor. Yangi kredit olishdan oldin uni to'lang." });

  const totalToPay = Math.round(amt * (1 + type.interest_percent / 100) * 100) / 100;
  const weeklyPayment = Math.round((totalToPay / type.installments_weeks) * 100) / 100;
  const nextPaymentAt = new Date(Date.now() + WEEK_MS).toISOString();

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(amt, req.user.id);
    await db.prepare(`
      INSERT INTO user_credits (user_id, credit_type_id, principal_amount, total_to_pay, remaining_amount, weekly_payment, next_payment_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, credit_type_id, amt, totalToPay, totalToPay, weeklyPayment, nextPaymentAt);
  });
  await tx();

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coin_balance: updatedUser.coin_balance });
});

// Mening kreditlarim
router.get('/credits/my', authMiddleware, async (req, res) => {
  await applyOverdueFines(req.user.id);
  const rows = await db.prepare(`
    SELECT uc.*, ct.name as type_name, ct.interest_percent
    FROM user_credits uc JOIN credit_types ct ON ct.id = uc.credit_type_id
    WHERE uc.user_id = ?
    ORDER BY uc.created_at DESC
  `).all(req.user.id);

  const getPayments = db.prepare(
    'SELECT amount, payment_type, created_at FROM credit_payments WHERE user_credit_id = ? ORDER BY created_at DESC LIMIT 10'
  );
  const withPayments = await Promise.all(rows.map(async r => ({ ...r, payments: await getPayments.all(r.id) })));
  res.json(withPayments);
});

// To'lov qilish: mode='scheduled' (jadval bo'yicha) yoki 'early' (oldindan, o'zi xohlagan summa)
router.post('/credits/:id/pay', authMiddleware, async (req, res) => {
  await applyOverdueFines(req.user.id);

  const credit = await db.prepare(
    "SELECT * FROM user_credits WHERE id = ? AND user_id = ?"
  ).get(req.params.id, req.user.id);
  if (!credit) return res.status(404).json({ error: 'Topilmadi' });
  if (credit.status !== 'active') return res.status(400).json({ error: "Bu kredit faol emas" });

  const { mode, amount } = req.body || {};
  let payAmount;

  if (mode === 'early') {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Miqdorni to'g'ri kiriting" });
    payAmount = Math.min(amt, credit.remaining_amount);
  } else {
    payAmount = Math.min(credit.weekly_payment, credit.remaining_amount);
  }

<<<<<<< HEAD
=======
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.coin_balance < payAmount) return res.status(400).json({ error: 'Coin yetarli emas' });

>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2
  const newRemaining = Math.round((credit.remaining_amount - payAmount) * 100) / 100;
  const newStatus = newRemaining <= 0 ? 'paid' : 'active';
  // Jadval bo'yicha to'lov navbatdagi sanani bir haftaga suradi; oldindan to'lov sanani o'zgartirmaydi
  const nextPaymentAt = mode === 'early'
    ? credit.next_payment_at
    : new Date(new Date(credit.next_payment_at).getTime() + WEEK_MS).toISOString();

<<<<<<< HEAD
  const deductResult = await db.prepare(
    'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
  ).run(payAmount, req.user.id, payAmount);
  if (!deductResult.changes) {
    return res.status(400).json({ error: 'Coin yetarli emas' });
  }

  await db.prepare(`
    UPDATE user_credits SET remaining_amount = ?, status = ?, next_payment_at = ? WHERE id = ?
  `).run(newRemaining, newStatus, nextPaymentAt, credit.id);
  await db.prepare(`
    INSERT INTO credit_payments (user_credit_id, amount, payment_type) VALUES (?, ?, ?)
  `).run(credit.id, payAmount, mode === 'early' ? 'early' : 'scheduled');
=======
  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance - ? WHERE id = ?').run(payAmount, req.user.id);
    await db.prepare(`
      UPDATE user_credits SET remaining_amount = ?, status = ?, next_payment_at = ? WHERE id = ?
    `).run(newRemaining, newStatus, nextPaymentAt, credit.id);
    await db.prepare(`
      INSERT INTO credit_payments (user_credit_id, amount, payment_type) VALUES (?, ?, ?)
    `).run(credit.id, payAmount, mode === 'early' ? 'early' : 'scheduled');
  });
  await tx();
>>>>>>> bb4ea32104466f7f5e0caadbde8e1ab38ce4edd2

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({
    ok: true,
    coin_balance: updatedUser.coin_balance,
    paid_amount: payAmount,
    remaining_amount: newRemaining,
    status: newStatus,
  });
});

module.exports = router;
