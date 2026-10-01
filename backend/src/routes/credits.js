const express = require('express');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const push = require('../push');
const guarantor = require('../guarantor');
const { applyOverdueFines } = guarantor; // jarima mexanizmi guarantor.js da (kafil bilan birga ishlaydi)

const router = express.Router();

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

// ---------- FOYDALANUVCHI ----------

// Mavjud kredit turlari
router.get('/credits/types', authMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM credit_types ORDER BY min_amount ASC').all());
});

// Kreditni haqiqatda berish (kafil tasdiqlagandan keyin chaqiriladi)
async function grantCredit(userId, type, amt, guarantorId) {
  const totalToPay = Math.round(amt * (1 + type.interest_percent / 100) * 100) / 100;
  const weeklyPayment = Math.round((totalToPay / type.installments_weeks) * 100) / 100;
  const nextPaymentAt = new Date(Date.now() + WEEK_MS).toISOString();

  const tx = db.transaction(async () => {
    await db.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(amt, userId);
    await db.prepare(`
      INSERT INTO user_credits (user_id, credit_type_id, principal_amount, total_to_pay, remaining_amount, weekly_payment, next_payment_at, guarantor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, type.id, amt, totalToPay, totalToPay, weeklyPayment, nextPaymentAt, guarantorId);
  });
  await tx();
}

// Kredit olish so'rovi: kredit DARHOL berilmaydi — avval kafil tasdiqlashi kerak
router.post('/credits/take', authMiddleware, async (req, res) => {
  const { credit_type_id, amount, guarantor_username } = req.body || {};
  const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(credit_type_id);
  if (!type) return res.status(404).json({ error: 'Kredit turi topilmadi' });

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < type.min_amount || amt > type.max_amount) {
    return res.status(400).json({ error: `Miqdor ${type.min_amount} - ${type.max_amount} orasida bo'lishi kerak` });
  }

  const uname = String(guarantor_username || '').trim().replace(/^@/, '');
  if (!uname) return res.status(400).json({ error: 'Kafil username kiriting' });

  const guarantor = await db.prepare('SELECT id, username, is_blocked FROM users WHERE username = ?').get(uname);
  if (!guarantor) return res.status(404).json({ error: 'Bunday username topilmadi' });
  if (guarantor.id === req.user.id) return res.status(400).json({ error: "O'zingizni kafil qila olmaysiz" });
  if (guarantor.is_blocked) return res.status(400).json({ error: 'Bu foydalanuvchi bloklangan, boshqa kafil tanlang' });

  const existingActive = await db.prepare(
    "SELECT id FROM user_credits WHERE user_id = ? AND status = 'active'"
  ).get(req.user.id);
  if (existingActive) return res.status(400).json({ error: "Sizda allaqachon faol krediting bor. Yangi kredit olishdan oldin uni to'lang." });

  const pending = await db.prepare(
    "SELECT id FROM credit_requests WHERE user_id = ? AND status = 'pending'"
  ).get(req.user.id);
  if (pending) return res.status(400).json({ error: "Sizda kafil javobini kutayotgan so'rov bor. Avval uni bekor qiling yoki javobni kuting." });

  await db.prepare(`
    INSERT INTO credit_requests (user_id, guarantor_id, credit_type_id, amount) VALUES (?, ?, ?, ?)
  `).run(req.user.id, guarantor.id, type.id, amt);

  push.notifyUser(guarantor.id, {
    title: '🤝 Kafillik so\'rovi',
    body: `@${req.user.username} sizni ${type.name} krediti (${amt} coin) uchun kafil qilmoqchi. Saytga kirib javob bering.`,
    url: '/index.html#kreditlar',
    tag: 'guarantor-request',
  });

  res.json({ ok: true, pending: true, guarantor_username: guarantor.username });
});

// Menga kelgan kafillik so'rovlari (javob kutayotganlar)
router.get('/credits/requests/incoming', authMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.amount, r.created_at,
           u.username AS requester_username,
           ct.name AS credit_name, ct.installments_weeks
    FROM credit_requests r
    JOIN users u ON u.id = r.user_id
    JOIN credit_types ct ON ct.id = r.credit_type_id
    WHERE r.guarantor_id = ? AND r.status = 'pending'
    ORDER BY r.created_at ASC
  `).all(req.user.id);
  res.json(rows);
});

// Mening yuborgan so'rovlarim (oxirgi 5 ta)
router.get('/credits/requests/mine', authMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.amount, r.status, r.created_at, r.responded_at,
           g.username AS guarantor_username,
           ct.name AS credit_name, ct.installments_weeks
    FROM credit_requests r
    JOIN users g ON g.id = r.guarantor_id
    JOIN credit_types ct ON ct.id = r.credit_type_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
    LIMIT 5
  `).all(req.user.id);
  res.json(rows);
});

// Kafil javobi: approve = true (tasdiqlash) yoki false (rad etish)
router.post('/credits/requests/:id/respond', authMiddleware, async (req, res) => {
  const approve = req.body?.approve === true || req.body?.approve === 'true';

  const reqRow = await db.prepare(
    "SELECT * FROM credit_requests WHERE id = ? AND guarantor_id = ?"
  ).get(req.params.id, req.user.id);
  if (!reqRow) return res.status(404).json({ error: "So'rov topilmadi" });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: "Bu so'rovga allaqachon javob berilgan yoki u bekor qilingan" });

  const requester = await db.prepare('SELECT id, username, is_blocked FROM users WHERE id = ?').get(reqRow.user_id);

  if (!approve) {
    const r = await db.prepare(
      "UPDATE credit_requests SET status = 'rejected', responded_at = ? WHERE id = ? AND status = 'pending'"
    ).run(new Date().toISOString(), reqRow.id);
    if (!r.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });
    if (requester) {
      push.notifyUser(requester.id, {
        title: '❌ Kafil rad etdi',
        body: `@${req.user.username} kreditingiz uchun kafil bo'lishdan bosh tortdi.`,
        url: '/index.html#kreditlar',
        tag: 'guarantor-response',
      });
    }
    return res.json({ ok: true, status: 'rejected' });
  }

  // Tasdiqlashdan oldin hammasini qayta tekshiramiz (vaqt o'tgan bo'lishi mumkin)
  const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(reqRow.credit_type_id);
  const activeCredit = requester
    ? await db.prepare("SELECT id FROM user_credits WHERE user_id = ? AND status = 'active'").get(requester.id)
    : null;

  if (!type || !requester || requester.is_blocked || activeCredit) {
    await db.prepare("UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending'")
      .run(new Date().toISOString(), reqRow.id);
    return res.status(400).json({ error: "Bu kreditni endi berib bo'lmaydi (kredit turi o'chirilgan, hisob bloklangan yoki faol kredit bor)" });
  }

  // Ikki marta bosilsa ham kredit faqat bir marta berilishi uchun avval holatni "approved" qilib olamiz
  const claim = await db.prepare(
    "UPDATE credit_requests SET status = 'approved', responded_at = ? WHERE id = ? AND status = 'pending'"
  ).run(new Date().toISOString(), reqRow.id);
  if (!claim.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });

  await grantCredit(requester.id, type, reqRow.amount, req.user.id);

  push.notifyUser(requester.id, {
    title: '✅ Kredit tasdiqlandi',
    body: `@${req.user.username} kafil bo'ldi. ${reqRow.amount} coin hisobingizga tushdi!`,
    url: '/index.html#kreditlar',
    tag: 'guarantor-response',
  });

  res.json({ ok: true, status: 'approved' });
});

// So'rovni bekor qilish (kredit so'ragan foydalanuvchi, kafil javob bermaguncha)
router.post('/credits/requests/:id/cancel', authMiddleware, async (req, res) => {
  const r = await db.prepare(
    "UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).run(new Date().toISOString(), req.params.id, req.user.id);
  if (!r.changes) return res.status(400).json({ error: "So'rovni bekor qilib bo'lmadi" });
  res.json({ ok: true });
});

// Mening kreditlarim
router.get('/credits/my', authMiddleware, async (req, res) => {
  await applyOverdueFines(req.user.id);
  const rows = await db.prepare(`
    SELECT uc.*, ct.name as type_name, ct.interest_percent, gu.username AS guarantor_username
    FROM user_credits uc
    JOIN credit_types ct ON ct.id = uc.credit_type_id
    LEFT JOIN users gu ON gu.id = uc.guarantor_id
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

  const newRemaining = Math.round((credit.remaining_amount - payAmount) * 100) / 100;
  const newStatus = newRemaining <= 0 ? 'paid' : 'active';
  // Jadval bo'yicha to'lov navbatdagi sanani bir haftaga suradi; oldindan to'lov sanani o'zgartirmaydi
  const nextPaymentAt = mode === 'early'
    ? credit.next_payment_at
    : new Date(new Date(credit.next_payment_at).getTime() + WEEK_MS).toISOString();

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

  const updatedUser = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(req.user.id);
  res.json({
    ok: true,
    coin_balance: updatedUser.coin_balance,
    paid_amount: payAmount,
    remaining_amount: newRemaining,
    status: newStatus,
  });
});


// ---------- KAFIL JAVOBGARLIGI ----------

// Kafil uchun: qarzdor to'lamagan (2 sutka ichida eslatish kerak) va kafildan yechilgan holatlar
router.get('/credits/guarantor/overdues', authMiddleware, async (req, res) => {
  await guarantor.maybeRunChecks();
  const base = `
    SELECT o.id, o.week_payment, o.penalty_amount, o.charged_amount, o.due_at, o.deadline_at, o.reminded_at,
           u.username AS borrower_username, ct.name AS credit_name
    FROM guarantor_overdues o
    JOIN users u ON u.id = o.borrower_id
    JOIN user_credits uc ON uc.id = o.user_credit_id
    JOIN credit_types ct ON ct.id = uc.credit_type_id
  `;
  const waiting = await db.prepare(
    base + " WHERE o.guarantor_id = ? AND o.status = 'waiting' ORDER BY o.deadline_at ASC"
  ).all(req.user.id);
  const charged = await db.prepare(
    base + " WHERE o.guarantor_id = ? AND o.status = 'charged' AND o.guarantor_seen = 0 ORDER BY o.resolved_at ASC"
  ).all(req.user.id);
  res.json({ waiting, charged, server_now: Date.now() });
});

// Kafil: qarzdorga to'lash haqida xabar beradi (push + saytga kirganda oyna)
router.post('/credits/guarantor/overdues/:id/remind', authMiddleware, async (req, res) => {
  const o = await db.prepare('SELECT * FROM guarantor_overdues WHERE id = ? AND guarantor_id = ?').get(req.params.id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Topilmadi' });
  if (o.status !== 'waiting' || Date.now() >= push.parseDate(o.deadline_at)) {
    return res.status(400).json({ error: "Muddat tugagan yoki qarzdor allaqachon to'lagan" });
  }
  if (o.reminded_at) {
    const sinceMs = Date.now() - push.parseDate(o.reminded_at);
    if (sinceMs < guarantor.REMIND_COOLDOWN_MS) {
      const minLeft = Math.ceil((guarantor.REMIND_COOLDOWN_MS - sinceMs) / 60000);
      return res.status(400).json({ error: `Yaqinda xabar yuborgansiz. ${minLeft} daqiqadan keyin qayta yuborishingiz mumkin.` });
    }
  }

  await db.prepare('UPDATE guarantor_overdues SET reminded_at = ?, borrower_seen = 0 WHERE id = ?')
    .run(new Date().toISOString(), o.id);

  push.notifyUser(o.borrower_id, {
    title: '⏰ Kafilingiz eslatdi',
    body: `@${req.user.username} sizga kredit to'lovini to'lashni eslatdi (${o.week_payment} coin). To'lamasangiz, kafilingiz jarimaga tortiladi.`,
    url: '/index.html#kreditlar',
    tag: `guarantor-remind-${o.id}`,
  });

  res.json({ ok: true });
});

// Kafil "hisobingizdan yechildi" xabarini ko'rdi
router.post('/credits/guarantor/charged-seen', authMiddleware, async (req, res) => {
  await db.prepare("UPDATE guarantor_overdues SET guarantor_seen = 1 WHERE guarantor_id = ? AND status = 'charged'").run(req.user.id);
  res.json({ ok: true });
});

// Qarzdor uchun: kafil yuborgan eslatmalar (hali ko'rilmaganlari)
router.get('/credits/borrower/reminders', authMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT o.id, o.week_payment, o.reminded_at, o.deadline_at,
           g.username AS guarantor_username, ct.name AS credit_name
    FROM guarantor_overdues o
    JOIN users g ON g.id = o.guarantor_id
    JOIN user_credits uc ON uc.id = o.user_credit_id
    JOIN credit_types ct ON ct.id = uc.credit_type_id
    WHERE o.borrower_id = ? AND o.status = 'waiting' AND o.reminded_at IS NOT NULL AND o.borrower_seen = 0
    ORDER BY o.reminded_at ASC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/credits/borrower/reminders/seen', authMiddleware, async (req, res) => {
  await db.prepare("UPDATE guarantor_overdues SET borrower_seen = 1 WHERE borrower_id = ? AND status = 'waiting'").run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
