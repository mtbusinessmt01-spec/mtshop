const express = require('express');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const push = require('../push');
const guarantor = require('../guarantor');
const rules = require('../creditRules');
const security = require('../security');
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

const round2 = rules.round2;
const nowIso = () => new Date().toISOString();

// ---------- Kredit olish oynasi uchun: shartlar ro'yxati, daraja, turlar ----------
router.get('/credits/eligibility', authMiddleware, async (req, res) => {
  try {
    await rules.sweepExpired();
    const s = await rules.getSettings();
    const el = await rules.eligibility(req.user.id, s);
    const types = await db.prepare('SELECT * FROM credit_types ORDER BY min_amount ASC').all();
    const access = rules.typesWithAccess(types, el.level).map(t => ({
      ...t,
      interest_effective: rules.effectiveInterest(t, el.hist, false, s),
      interest_with_collateral: rules.effectiveInterest(t, el.hist, true, s),
      collateral_required_from: s.credit_collateral_required_amount,
    }));
    const u = await db.prepare('SELECT credit_lock_until FROM users WHERE id = ?').get(req.user.id);
    const lockMs = u && u.credit_lock_until ? security.parseTs(u.credit_lock_until) - Date.now() : 0;
    res.json({
      checks: el.checks, all_ok: el.all_ok, rating: el.rating, attempts_left: el.attempts_left,
      types: access, rules: rules.publicRules(s),
      credit_lock_until: lockMs > 0 ? new Date(security.parseTs(u.credit_lock_until)).toISOString() : null,
    });
  } catch (e) {
    console.error('Kredit shartlari xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Kafil nomzodini jonli tekshirish (username yozilganda)
router.get('/credits/guarantor-check', authMiddleware, async (req, res) => {
  try {
    const uname = String(req.query.username || '').trim().replace(/^@/, '');
    const amt = parseFloat(req.query.amount) || 0;
    if (!uname) return res.json({ found: false, ok: false, checks: [] });
    const g = await db.prepare('SELECT id, username, is_blocked, created_at, coin_balance, pin_hash FROM users WHERE username = ?').get(uname);
    if (!g) return res.json({ found: false, ok: false, checks: [], error: 'Bunday username topilmadi' });
    if (g.id === req.user.id) return res.json({ found: true, ok: false, checks: [], error: "O'zingizni kafil qila olmaysiz" });
    if (g.is_blocked) return res.json({ found: true, ok: false, checks: [], error: 'Bu foydalanuvchi bloklangan' });
    const s = await rules.getSettings();
    const checks = await rules.guarantorChecks(req.user.id, g, amt, s);
    res.json({ found: true, ok: checks.every(c => c.ok), username: g.username, checks });
  } catch (e) {
    console.error('Kafil tekshiruvi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Shartlarni oldindan hisoblash (oyna: "Kredit shartlari") — hech narsa yozmaydi
router.post('/credits/preview', authMiddleware, async (req, res) => {
  try {
    const { credit_type_id, amount, collateral_user_gift_id } = req.body || {};
    const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(credit_type_id);
    if (!type) return res.status(404).json({ error: 'Kredit turi topilmadi' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < type.min_amount || amt > type.max_amount) {
      return res.status(400).json({ error: `Miqdor ${type.min_amount} - ${type.max_amount} orasida bo'lishi kerak` });
    }
    const s = await rules.getSettings();
    const hist = await rules.history(req.user.id, s);
    const hasCol = !!collateral_user_gift_id;
    const interest = rules.effectiveInterest(type, hist, hasCol, s);
    const terms = rules.computeTerms(type, amt, interest);
    res.json({
      credit_name: type.name, amount: amt, interest_percent: interest, base_interest_percent: type.interest_percent,
      ...terms,
      fine_percent: guarantor.FINE_RATE * 100, fine_amount: round2(amt * guarantor.FINE_RATE), max_fines: guarantor.MAX_FINES,
      guarantor_penalty_percent: guarantor.GUARANTOR_PENALTY_RATE * 100,
      guarantor_penalty_amount: round2(terms.weekly_payment * guarantor.GUARANTOR_PENALTY_RATE),
      collateral_required: rules.collateralRequired(amt, s), collateral_min_value: rules.collateralMinValue(amt, s),
      has_collateral: hasCol,
      needs_admin: s.credit_admin_approval_amount > 0 && amt >= s.credit_admin_approval_amount,
      lock_hours: s.credit_lock_hours, accept_minutes: s.credit_borrower_accept_minutes,
      terms_seconds: s.credit_terms_seconds,
    });
  } catch (e) {
    console.error('Kredit preview xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Kreditni haqiqatda berish — bitta tranzaksiyada (coin + kredit yozuvi + coin qulfi)
async function grantCredit(userId, type, amt, guarantorId, interestPercent, collateralUgId, s) {
  const terms = rules.computeTerms(type, amt, interestPercent);
  const nextPaymentAt = new Date(Date.now() + WEEK_MS).toISOString();
  await db.withTx(async (tx) => {
    await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(amt, userId);
    await tx.prepare(`
      INSERT INTO user_credits (user_id, credit_type_id, principal_amount, total_to_pay, remaining_amount, weekly_payment, next_payment_at, guarantor_id, collateral_user_gift_id, collateral_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, type.id, amt, terms.total_to_pay, terms.total_to_pay, terms.weekly_payment, nextPaymentAt, guarantorId,
      collateralUgId || null, collateralUgId ? 'locked' : null);
    if (s.credit_lock_hours > 0) {
      const until = await rules.lockUntilIso(s.credit_lock_hours);
      await tx.prepare(`
        UPDATE users SET credit_lock_until = CASE WHEN credit_lock_until IS NOT NULL AND credit_lock_until > ? THEN credit_lock_until ELSE ? END
        WHERE id = ?
      `).run(until, until, userId);
    }
  });
}

// Kredit olish so'rovi: kredit DARHOL berilmaydi. Bosqichlar: kafil -> (katta summada) admin -> qarzdor "Qabul qilaman"
router.post('/credits/take', authMiddleware, async (req, res) => {
  try {
    await rules.sweepExpired();
    const { credit_type_id, amount, guarantor_username, collateral_user_gift_id, terms_accepted, confirm_amount } = req.body || {};
    const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(credit_type_id);
    if (!type) return res.status(404).json({ error: 'Kredit turi topilmadi' });

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < type.min_amount || amt > type.max_amount) {
      return res.status(400).json({ error: `Miqdor ${type.min_amount} - ${type.max_amount} orasida bo'lishi kerak` });
    }

    const s = await rules.getSettings();
    const el = await rules.eligibility(req.user.id, s);
    const failed = el.checks.find(c => !c.ok);
    if (failed) {
      return res.status(400).json({ error: failed.detail, check: failed.key, checks: el.checks, pin_setup_required: failed.key === 'has_pin' });
    }

    const types = await db.prepare('SELECT * FROM credit_types').all();
    const mine = rules.typesWithAccess(types, el.level).find(t => t.id === type.id);
    if (!mine || !mine.unlocked) {
      return res.status(403).json({ error: `Bu kredit turi sizga hali ochilmagan. ${mine ? mine.unlock_hint : ''}`.trim() });
    }

    if (terms_accepted !== true) return res.status(400).json({ error: 'Kredit shartlarini tasdiqlang' });
    if (Number(confirm_amount) !== amt) return res.status(400).json({ error: 'Tasdiqlash uchun kredit summasini aniq yozing' });

    const uname = String(guarantor_username || '').trim().replace(/^@/, '');
    if (!uname) return res.status(400).json({ error: 'Kafil username kiriting' });
    const g = await db.prepare('SELECT id, username, is_blocked, created_at, coin_balance, pin_hash FROM users WHERE username = ?').get(uname);
    if (!g) return res.status(404).json({ error: 'Bunday username topilmadi' });
    if (g.id === req.user.id) return res.status(400).json({ error: "O'zingizni kafil qila olmaysiz" });
    if (g.is_blocked) return res.status(400).json({ error: 'Bu foydalanuvchi bloklangan, boshqa kafil tanlang' });
    const gFail = (await rules.guarantorChecks(req.user.id, g, amt, s)).find(c => !c.ok);
    if (gFail) return res.status(400).json({ error: gFail.detail, check: gFail.key });

    // Garov
    let collateral = null;
    if (collateral_user_gift_id) {
      const v = await rules.validateCollateral(req.user.id, collateral_user_gift_id, amt, s);
      if (!v.ok) return res.status(400).json({ error: v.error, collateral_invalid: true });
      collateral = v.gift;
    } else if (rules.collateralRequired(amt, s)) {
      return res.status(400).json({
        error: `${s.credit_collateral_required_amount} coin va undan katta kreditlarda garov (gift) majburiy`,
        collateral_required: true, collateral_min_value: rules.collateralMinValue(amt, s),
      });
    }

    // PIN — barcha tekshiruvlardan keyin (xato bo'lsa PIN so'ralmaydi)
    if (!(await rules.pinGate(req, res))) return;

    const interest = rules.effectiveInterest(type, el.hist, !!collateral, s);
    let requestId;
    try {
      requestId = await db.withTx(async (tx) => {
        const dup = await tx.prepare("SELECT id FROM credit_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
        if (dup) throw new Error('PENDING_EXISTS');
        const ins = await tx.prepare(`
          INSERT INTO credit_requests (user_id, guarantor_id, credit_type_id, amount, stage, collateral_user_gift_id, interest_percent)
          VALUES (?, ?, ?, ?, 'guarantor', ?, ?)
        `).run(req.user.id, g.id, type.id, amt, collateral ? collateral.id : null, interest);
        if (collateral) {
          const lock = await tx.prepare('UPDATE user_gifts SET trade_id = ? WHERE id = ? AND user_id = ? AND trade_id IS NULL')
            .run(-ins.lastInsertRowid, collateral.id, req.user.id);
          if (!lock.changes) throw new Error('COLLATERAL_BUSY');
        }
        return ins.lastInsertRowid;
      });
    } catch (e) {
      if (e.message === 'PENDING_EXISTS') return res.status(400).json({ error: "Sizda javob kutayotgan so'rov bor. Avval uni yakunlang yoki bekor qiling." });
      if (e.message === 'COLLATERAL_BUSY') return res.status(409).json({ error: 'Garov gifti band bo\'lib qoldi. Boshqa gift tanlang' });
      throw e;
    }

    push.notifyUser(g.id, {
      title: '🤝 Kafillik so\'rovi',
      body: `@${req.user.username} sizni ${type.name} krediti (${amt} coin) uchun kafil qilmoqchi. Saytga kirib javob bering.`,
      url: '/index.html#kreditlar', tag: 'guarantor-request', category: 'credit',
    });

    res.json({ ok: true, pending: true, request_id: requestId, guarantor_username: g.username, interest_percent: interest });
  } catch (e) {
    console.error('Kredit so\'rovi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Menga kelgan kafillik so'rovlari (javob kutayotganlar)
router.get('/credits/requests/incoming', authMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.amount, r.created_at,
           u.username AS requester_username,
           ct.name AS credit_name, ct.installments_weeks,
           CASE WHEN r.collateral_user_gift_id IS NOT NULL THEN 1 ELSE 0 END AS has_collateral
    FROM credit_requests r
    JOIN users u ON u.id = r.user_id
    JOIN credit_types ct ON ct.id = r.credit_type_id
    WHERE r.guarantor_id = ? AND r.status = 'pending' AND r.stage = 'guarantor'
    ORDER BY r.created_at ASC
  `).all(req.user.id);
  res.json(rows);
});

// Mening yuborgan so'rovlarim (oxirgi 5 ta)
router.get('/credits/requests/mine', authMiddleware, async (req, res) => {
  await rules.sweepExpired();
  const rows = await db.prepare(`
    SELECT r.id, r.amount, r.status, r.stage, r.stage_expires_at, r.created_at, r.responded_at, r.interest_percent,
           g.username AS guarantor_username,
           ct.name AS credit_name, ct.installments_weeks,
           CASE WHEN r.collateral_user_gift_id IS NOT NULL THEN 1 ELSE 0 END AS has_collateral
    FROM credit_requests r
    JOIN users g ON g.id = r.guarantor_id
    JOIN credit_types ct ON ct.id = r.credit_type_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
    LIMIT 5
  `).all(req.user.id);
  res.json(rows.map(r => ({ ...r, server_now: Date.now() })));
});

// Qarzdorga "Qabul qilaman" bosqichiga o'tkazish (kafil yoki admin tasdig'idan keyin)
async function moveToBorrowerStage(reqRow, s, type, fromStage) {
  const expires = new Date(Date.now() + s.credit_borrower_accept_minutes * 60000).toISOString();
  const r = await db.prepare(
    "UPDATE credit_requests SET stage = 'borrower', stage_expires_at = ?, responded_at = ? WHERE id = ? AND status = 'pending' AND stage = ?"
  ).run(expires, nowIso(), reqRow.id, fromStage);
  if (!r.changes) return false;
  push.notifyUser(reqRow.user_id, {
    title: '✅ Kredit tasdiqlandi — qabul qiling',
    body: `${type.name} (${reqRow.amount} coin) tasdiqlandi. ${s.credit_borrower_accept_minutes} daqiqa ichida saytga kirib "Qabul qilaman" tugmasini bosing, aks holda so'rov bekor bo'ladi.`,
    url: '/index.html#kreditlar', tag: 'credit-accept', category: 'credit',
  });
  return true;
}

// Kafil javobi: approve = true (tasdiqlash) yoki false (rad etish)
router.post('/credits/requests/:id/respond', authMiddleware, async (req, res) => {
  try {
    const approve = req.body?.approve === true || req.body?.approve === 'true';

    const reqRow = await db.prepare("SELECT * FROM credit_requests WHERE id = ? AND guarantor_id = ?").get(req.params.id, req.user.id);
    if (!reqRow) return res.status(404).json({ error: "So'rov topilmadi" });
    if (reqRow.status !== 'pending' || reqRow.stage !== 'guarantor') {
      return res.status(400).json({ error: "Bu so'rovga allaqachon javob berilgan yoki u bekor qilingan" });
    }

    const requester = await db.prepare('SELECT id, username, is_blocked FROM users WHERE id = ?').get(reqRow.user_id);

    if (!approve) {
      const r = await db.prepare(
        "UPDATE credit_requests SET status = 'rejected', responded_at = ? WHERE id = ? AND status = 'pending' AND stage = 'guarantor'"
      ).run(nowIso(), reqRow.id);
      if (!r.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });
      await rules.releaseForRequest(reqRow.id);
      if (requester) {
        push.notifyUser(requester.id, {
          title: '❌ Kafil rad etdi',
          body: `@${req.user.username} kreditingiz uchun kafil bo'lishdan bosh tortdi.`,
          url: '/index.html#kreditlar', tag: 'guarantor-response', category: 'credit',
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
      await db.prepare("UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), reqRow.id);
      await rules.releaseForRequest(reqRow.id);
      return res.status(400).json({ error: "Bu kreditni endi berib bo'lmaydi (kredit turi o'chirilgan, hisob bloklangan yoki faol kredit bor)" });
    }

    const s = await rules.getSettings();
    const me = await db.prepare('SELECT id, created_at, coin_balance, pin_hash FROM users WHERE id = ?').get(req.user.id);
    const gFail = (await rules.guarantorChecks(requester.id, me, reqRow.amount, s, reqRow.id)).find(c => !c.ok);
    if (gFail) {
      return res.status(400).json({
        error: gFail.key === 'g_pin'
          ? "Kafil bo'lish uchun avval tranzaksiya PIN o'rnating (Profil > Xavfsizlik)"
          : `Siz kafil bo'lish talablariga javob bermaysiz: ${gFail.label}`,
        check: gFail.key, pin_setup_required: gFail.key === 'g_pin',
      });
    }

    if (!(await rules.pinGate(req, res))) return;

    const needsAdmin = s.credit_admin_approval_amount > 0 && reqRow.amount >= s.credit_admin_approval_amount;
    if (needsAdmin) {
      const r = await db.prepare(
        "UPDATE credit_requests SET stage = 'admin', responded_at = ? WHERE id = ? AND status = 'pending' AND stage = 'guarantor'"
      ).run(nowIso(), reqRow.id);
      if (!r.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });
      push.notifyUser(requester.id, {
        title: '🤝 Kafil tasdiqladi',
        body: `@${req.user.username} kafil bo'ldi. Kredit katta summada, shuning uchun admin tasdig'i kutilmoqda.`,
        url: '/index.html#kreditlar', tag: 'guarantor-response', category: 'credit',
      });
      rules.notifyAdmins({
        title: '🛡️ Kredit tasdig\'i kerak',
        body: `@${requester.username} — ${type.name}, ${reqRow.amount} coin. Admin panelda ko'rib chiqing.`,
        url: '/admin.html', tag: `credit-admin-${reqRow.id}`, category: 'credit',
      }).catch(() => {});
      return res.json({ ok: true, status: 'pending', stage: 'admin' });
    }

    if (!(await moveToBorrowerStage(reqRow, s, type, 'guarantor'))) return res.status(400).json({ error: "So'rov holati o'zgargan" });
    res.json({ ok: true, status: 'pending', stage: 'borrower' });
  } catch (e) {
    console.error('Kafil javobi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Qarzdor: "Qabul qilaman" — kredit shu yerda haqiqatan beriladi
router.post('/credits/requests/:id/accept', authMiddleware, async (req, res) => {
  try {
    await rules.sweepExpired();
    const reqRow = await db.prepare('SELECT * FROM credit_requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!reqRow) return res.status(404).json({ error: "So'rov topilmadi" });
    if (reqRow.status !== 'pending' || reqRow.stage !== 'borrower') {
      return res.status(400).json({ error: reqRow.status === 'cancelled' ? "Qabul qilish vaqti tugagan, so'rov bekor qilingan" : "Bu so'rovni hozir qabul qilib bo'lmaydi" });
    }
    if (reqRow.stage_expires_at && security.parseTs(reqRow.stage_expires_at) < Date.now()) {
      await rules.sweepExpired();
      return res.status(400).json({ error: "Qabul qilish vaqti tugadi, so'rov bekor qilindi" });
    }

    const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(reqRow.credit_type_id);
    const me = await db.prepare('SELECT id, is_blocked, frozen, frozen_until, pin_hash FROM users WHERE id = ?').get(req.user.id);
    const g = await db.prepare('SELECT id, is_blocked, created_at, coin_balance, pin_hash FROM users WHERE id = ?').get(reqRow.guarantor_id);
    const active = await db.prepare("SELECT id FROM user_credits WHERE user_id = ? AND status = 'active'").get(req.user.id);
    const s = await rules.getSettings();

    const cancel = async (msg) => {
      await db.prepare("UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending'").run(nowIso(), reqRow.id);
      await rules.releaseForRequest(reqRow.id);
      return res.status(400).json({ error: msg });
    };
    if (!type || !me || me.is_blocked || active) return cancel("Bu kreditni endi berib bo'lmaydi (faol kredit bor yoki hisob bloklangan)");
    if (security.isFrozenRow(me)) return res.status(403).json({ error: security.FROZEN_MSG, account_frozen: true });
    if (!me.pin_hash) return res.status(400).json({ error: "Avval tranzaksiya PIN o'rnating", pin_setup_required: true });
    if (!g || g.is_blocked) return cancel('Kafil endi mavjud emas yoki bloklangan, so\'rov bekor qilindi');
    const gFail = (await rules.guarantorChecks(req.user.id, g, reqRow.amount, s, reqRow.id)).find(c => !c.ok);
    if (gFail) return cancel("Kafil talablarga endi javob bermaydi (masalan, balansi kamaygan). So'rov bekor qilindi, yangi kafil bilan qayta urinib ko'ring");

    // Garov hamon qulflangan bo'lishi kerak
    let colId = null;
    if (reqRow.collateral_user_gift_id) {
      const ug = await db.prepare('SELECT id FROM user_gifts WHERE id = ? AND user_id = ? AND trade_id = ?')
        .get(reqRow.collateral_user_gift_id, req.user.id, -reqRow.id);
      if (!ug) return cancel("Garov gifti topilmadi, so'rov bekor qilindi");
      colId = ug.id;
    }

    if (!(await rules.pinGate(req, res))) return;

    const claim = await db.prepare(
      "UPDATE credit_requests SET status = 'approved', stage = 'done', responded_at = ? WHERE id = ? AND status = 'pending' AND stage = 'borrower'"
    ).run(nowIso(), reqRow.id);
    if (!claim.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });

    const hist = await rules.history(req.user.id, s);
    const interest = reqRow.interest_percent != null ? reqRow.interest_percent : rules.effectiveInterest(type, hist, !!colId, s);
    await grantCredit(req.user.id, type, reqRow.amount, g.id, interest, colId, s);

    push.notifyUser(g.id, {
      title: '🤝 Kafilligingiz kuchga kirdi',
      body: `@${req.user.username} ${reqRow.amount} coin kredit oldi. U to'lamasa, kafil sifatida jarimaga tortilishingiz mumkin.`,
      url: '/index.html#kreditlar', tag: 'guarantor-active', category: 'credit',
    });

    const u = await db.prepare('SELECT coin_balance, credit_lock_until FROM users WHERE id = ?').get(req.user.id);
    res.json({ ok: true, status: 'approved', coin_balance: u.coin_balance, credit_lock_until: u.credit_lock_until, lock_hours: s.credit_lock_hours });
  } catch (e) {
    console.error('Kreditni qabul qilish xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// So'rovni bekor qilish (qarzdor, kredit berilguncha istalgan bosqichda)
router.post('/credits/requests/:id/cancel', authMiddleware, async (req, res) => {
  const r = await db.prepare(
    "UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).run(nowIso(), req.params.id, req.user.id);
  if (!r.changes) return res.status(400).json({ error: "So'rovni bekor qilib bo'lmadi" });
  await rules.releaseForRequest(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ---------- ADMIN: katta kreditlarni tasdiqlash va qoidalar ----------
router.get('/admin/credit-requests', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.amount, r.created_at, r.responded_at, r.interest_percent,
           u.username AS borrower_username, g.username AS guarantor_username,
           ct.name AS credit_name, ct.installments_weeks,
           (SELECT COALESCE(v.name, gi.name) FROM user_gifts ug JOIN gifts gi ON gi.id = ug.gift_id
              LEFT JOIN gift_variants v ON v.id = ug.variant_id WHERE ug.id = r.collateral_user_gift_id) AS collateral_name
    FROM credit_requests r
    JOIN users u ON u.id = r.user_id JOIN users g ON g.id = r.guarantor_id
    JOIN credit_types ct ON ct.id = r.credit_type_id
    WHERE r.status = 'pending' AND r.stage = 'admin'
    ORDER BY r.responded_at ASC
  `).all();
  res.json(rows);
});

router.post('/admin/credit-requests/:id/respond', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const approve = req.body?.approve === true || req.body?.approve === 'true';
    const reqRow = await db.prepare("SELECT * FROM credit_requests WHERE id = ? AND status = 'pending' AND stage = 'admin'").get(req.params.id);
    if (!reqRow) return res.status(404).json({ error: "So'rov topilmadi yoki allaqachon ko'rib chiqilgan" });

    if (!approve) {
      const r = await db.prepare(
        "UPDATE credit_requests SET status = 'rejected', responded_at = ? WHERE id = ? AND status = 'pending' AND stage = 'admin'"
      ).run(nowIso(), reqRow.id);
      if (!r.changes) return res.status(400).json({ error: "So'rov holati o'zgargan" });
      await rules.releaseForRequest(reqRow.id);
      push.notifyUser(reqRow.user_id, {
        title: '❌ Kredit rad etildi',
        body: "Kreditingiz admin tomonidan rad etildi.",
        url: '/index.html#kreditlar', tag: 'credit-admin-response', category: 'credit',
      });
      return res.json({ ok: true, status: 'rejected' });
    }

    const type = await db.prepare('SELECT * FROM credit_types WHERE id = ?').get(reqRow.credit_type_id);
    if (!type) return res.status(400).json({ error: "Kredit turi o'chirilgan" });
    const s = await rules.getSettings();
    if (!(await moveToBorrowerStage(reqRow, s, type, 'admin'))) return res.status(400).json({ error: "So'rov holati o'zgargan" });
    res.json({ ok: true, status: 'pending', stage: 'borrower' });
  } catch (e) {
    console.error('Admin kredit javobi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.get('/admin/credit-settings', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(rules.settingsForAdmin(await rules.getSettings()));
});

router.put('/admin/credit-settings', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await rules.saveSettings((req.body && req.body.settings) || {});
    res.json(rules.settingsForAdmin(await rules.getSettings()));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('Kredit sozlamalari xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// Mening kreditlarim
router.get('/credits/my', authMiddleware, async (req, res) => {
  await applyOverdueFines(req.user.id);
  const rows = await db.prepare(`
    SELECT uc.*, ct.name as type_name, ct.interest_percent, gu.username AS guarantor_username,
           (SELECT COALESCE(v.name, gi.name) FROM user_gifts ug JOIN gifts gi ON gi.id = ug.gift_id
              LEFT JOIN gift_variants v ON v.id = ug.variant_id WHERE ug.id = uc.collateral_user_gift_id) AS collateral_name
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
    UPDATE user_credits SET remaining_amount = ?, status = ?, next_payment_at = ?, closed_at = CASE WHEN ? = 'paid' THEN ? ELSE closed_at END WHERE id = ?
  `).run(newRemaining, newStatus, nextPaymentAt, newStatus, new Date().toISOString(), credit.id);
  if (newStatus === 'paid' && credit.collateral_user_gift_id) {
    // Kredit to'liq yopildi — garov (gift) qaytariladi
    await rules.releaseGiftById(credit.collateral_user_gift_id);
    await db.prepare("UPDATE user_credits SET collateral_status = 'released' WHERE id = ?").run(credit.id);
  }
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
    category: 'credit',
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
