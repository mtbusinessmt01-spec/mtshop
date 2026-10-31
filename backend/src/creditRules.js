// Kredit olishni qiyinlashtirish qoidalari: shartlar ro'yxati, daraja (reyting), kafil talablari,
// garov (gift), kredit coinini vaqtincha qulflash, PIN tasdig'i.
// Barcha raqamlar (kunlar, foizlar, summalar) app_settings jadvalida (kalitlar "credit_..." bilan boshlanadi),
// admin panelidan o'zgartiriladi.
const db = require('./db');
const security = require('./security');
const push = require('./push');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const parseTs = security.parseTs;
const sqlTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// ---------- Sozlamalar ----------
// [kalit, standart qiymat, sarlavha, izoh, min, max]
const SETTING_DEFS = [
  ['credit_min_account_days', 7, 'Akkaunt yoshi (kun)', 'Kredit olish uchun akkaunt kamida shuncha kunlik bo\'lishi kerak', 0, 3650],
  ['credit_min_activity', 3, 'Minimal faollik (ta)', 'Kamida shuncha xarid yoki tranzaksiya (gift, case, pet, transfer)', 0, 1000],
  ['credit_cooldown_hours', 24, 'Sovutish davri (soat)', 'Oldingi kredit yopilgandan keyin yangisini olish uchun kutish', 0, 720],
  ['credit_reject_pause_minutes', 60, 'Rad etilgandan keyingi pauza (daqiqa)', 'Kafil rad etganidan keyin yangi so\'rov yuborish uchun kutish', 0, 10080],
  ['credit_daily_attempts', 3, 'Kunlik urinishlar (ta)', 'Oxirgi 24 soatda ko\'pi bilan shuncha so\'rov', 1, 100],
  ['credit_recent_fine_days', 14, 'Kechikish tekshiruvi (kun)', 'Oxirgi shuncha kunda to\'lov kechiktirilgan bo\'lsa, kredit berilmaydi (0 = o\'chiq)', 0, 365],
  ['credit_level_penalty_days', 60, 'Daraja jarimasi muddati (kun)', 'Kechikkan kredit shuncha kun davomida darajani tushiradi', 0, 3650],
  ['credit_lock_hours', 48, 'Kredit coinini qulflash (soat)', 'Kredit tushgandan keyin shuncha soat jo\'natish va trade mumkin emas (do\'konda xarid qilish mumkin). 0 = o\'chiq', 0, 720],
  ['credit_borrower_accept_minutes', 10, 'Qabul qilish vaqti (daqiqa)', 'Kafil/admin tasdiqlagandan keyin qarzdor "Qabul qilaman" tugmasini bosishi kerak', 1, 1440],
  ['credit_admin_approval_amount', 1000, 'Admin tasdig\'i chegarasi (coin)', 'Shu summa va undan katta kreditlar admin tasdig\'iga tushadi (0 = o\'chiq)', 0, 100000000],
  ['credit_guarantor_min_days', 14, 'Kafil akkaunti yoshi (kun)', 'Kafilning akkaunti kamida shuncha kunlik bo\'lishi kerak', 0, 3650],
  ['credit_guarantor_min_balance_percent', 50, 'Kafil balansi (% kredit summasidan)', 'Kafilda kamida kredit summasining shuncha foizi coin bo\'lishi kerak', 0, 1000],
  ['credit_guarantor_max_active', 2, 'Kafilning maks. faol kafilliklari (ta)', 'Bitta kafil bir vaqtda ko\'pi bilan shuncha kreditga kafil bo\'ladi', 1, 100],
  ['credit_block_same_ip', 1, 'Bir IP dan kirganlarni rad etish (1/0)', 'Qarzdor va kafil oxirgi 30 kunda bir IP dan kirgan bo\'lsa, kafil sifatida qabul qilinmaydi', 0, 1],
  ['credit_collateral_required_amount', 500, 'Garov majburiy bo\'ladigan summa (coin)', 'Shu summa va undan katta kreditlarda garov (gift) majburiy (0 = hech qachon majburiy emas)', 0, 100000000],
  ['credit_collateral_value_percent', 100, 'Garov qiymati (% kredit summasidan)', 'Garovdagi gift narxi kamida kredit summasining shuncha foizi bo\'lishi kerak', 1, 1000],
  ['credit_collateral_discount_percent', 2, 'Garov uchun foiz chegirmasi', 'Garov qo\'ygan odamga kredit foizidan shuncha ayriladi', 0, 100],
  ['credit_new_user_extra_percent', 3, 'Yangi qarzdor uchun qo\'shimcha foiz', 'Hali birorta kreditni o\'z vaqtida yopmagan odamga foizga qo\'shiladi', 0, 100],
  ['credit_good_user_discount_percent', 2, 'Yaxshi qarzdor uchun chegirma', 'Ishonchli qarzdorga foizdan shuncha ayriladi', 0, 100],
  ['credit_good_user_min_paid', 3, 'Yaxshi qarzdor: yopilgan kreditlar (ta)', 'Shuncha kreditni o\'z vaqtida yopgan va yaqinda kechikmagan odam "yaxshi qarzdor"', 1, 1000],
  ['credit_terms_seconds', 5, 'Shartlarni o\'qish vaqti (soniya)', 'Shartlar oynasida tasdiqlash tugmasi shuncha soniyadan keyin faollashadi', 0, 120],
];
const DEFAULTS = Object.fromEntries(SETTING_DEFS.map(d => [d[0], d[1]]));

async function getSettings() {
  const rows = await db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'credit\\_%' ESCAPE '\\'").all();
  const s = { ...DEFAULTS };
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    const v = parseFloat(r.value);
    if (!isNaN(v) && v >= 0) s[r.key] = v;
  }
  return s;
}

function settingsForAdmin(s) {
  return SETTING_DEFS.map(([key, def, label, hint, min, max]) => ({ key, label, hint, min, max, default: def, value: s[key] }));
}

async function saveSettings(input) {
  const out = {};
  for (const [key, , , , min, max] of SETTING_DEFS) {
    if (!(key in input)) continue;
    const v = parseFloat(input[key]);
    if (isNaN(v) || v < min || v > max) {
      const e = new Error(`"${key}" qiymati ${min} dan ${max} gacha bo'lishi kerak`);
      e.status = 400; throw e;
    }
    out[key] = Math.round(v * 100) / 100;
  }
  for (const [k, v] of Object.entries(out)) {
    await db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(k, String(v));
  }
  return out;
}

// Foydalanuvchiga ko'rsatiladigan (maxfiy bo'lmagan) qoidalar
function publicRules(s) {
  return {
    terms_seconds: s.credit_terms_seconds,
    lock_hours: s.credit_lock_hours,
    accept_minutes: s.credit_borrower_accept_minutes,
    admin_approval_amount: s.credit_admin_approval_amount,
    collateral_required_amount: s.credit_collateral_required_amount,
    collateral_value_percent: s.credit_collateral_value_percent,
    collateral_discount_percent: s.credit_collateral_discount_percent,
    guarantor_min_days: s.credit_guarantor_min_days,
    guarantor_min_balance_percent: s.credit_guarantor_min_balance_percent,
    guarantor_max_active: s.credit_guarantor_max_active,
    daily_attempts: s.credit_daily_attempts,
  };
}

// ---------- Tarix va daraja (reyting) ----------
async function history(userId, s) {
  const rows = await db.prepare(
    'SELECT status, fine_count, created_at, closed_at, last_fine_at FROM user_credits WHERE user_id = ?'
  ).all(userId);
  const now = Date.now();
  const h = { cleanPaid: 0, latePaid: 0, defaulted: 0, recentFines: 0, lastFineAt: 0, lastClosedAt: 0 };
  for (const r of rows) {
    if (r.status === 'paid') { if ((r.fine_count || 0) === 0) h.cleanPaid++; else h.latePaid++; }
    else if (r.status === 'defaulted') h.defaulted++;
    if ((r.fine_count || 0) > 0) {
      const t = parseTs(r.last_fine_at || r.closed_at || r.created_at) || 0;
      h.lastFineAt = Math.max(h.lastFineAt, t);
      if (now - t < s.credit_level_penalty_days * DAY) h.recentFines++;
    }
    if (r.status !== 'active') {
      h.lastClosedAt = Math.max(h.lastClosedAt, parseTs(r.closed_at || r.created_at) || 0);
    }
  }
  h.level = Math.max(0, h.cleanPaid - h.recentFines - 2 * h.defaulted);
  return h;
}

function ratingName(level) {
  if (level >= 5) return "A'lo";
  if (level >= 3) return 'Yaxshi';
  if (level >= 1) return 'Ishonchli';
  return 'Yangi';
}

// Kredit turlari kichikdan kattaga: i-tur "i-daraja"dan ochiladi
function typesWithAccess(types, level) {
  const sorted = [...types].sort((a, b) => (a.max_amount - b.max_amount) || (a.min_amount - b.min_amount) || (a.id - b.id));
  return sorted.map((t, i) => {
    const unlocked = i <= level;
    const need = i - level;
    return {
      ...t, tier: i, unlocked,
      unlock_hint: unlocked ? null : `Yana ${need} ta kreditni o'z vaqtida yopsangiz ochiladi`,
    };
  });
}

// Reytingga va garovga qarab foiz
function effectiveInterest(type, hist, hasCollateral, s) {
  let p = Number(type.interest_percent) || 0;
  if (hist.cleanPaid === 0) p += s.credit_new_user_extra_percent;
  else if (hist.cleanPaid >= s.credit_good_user_min_paid && hist.recentFines === 0) p -= s.credit_good_user_discount_percent;
  if (hasCollateral) p -= s.credit_collateral_discount_percent;
  return Math.max(0, round2(p));
}

function computeTerms(type, amt, interestPercent) {
  const total = round2(amt * (1 + interestPercent / 100));
  const weekly = round2(total / type.installments_weeks);
  return { total_to_pay: total, weekly_payment: weekly, weeks: type.installments_weeks };
}

// ---------- Qarzdor shartlari ro'yxati ----------
async function activityCount(userId) {
  const r = await db.prepare(`
    SELECT (SELECT COUNT(*) FROM user_gifts WHERE user_id = ?)
         + (SELECT COUNT(*) FROM user_cases WHERE user_id = ?)
         + (SELECT COUNT(*) FROM user_pets WHERE user_id = ?)
         + (SELECT COUNT(*) FROM transfers WHERE from_user_id = ? OR to_user_id = ?) AS n
  `).get(userId, userId, userId, userId, userId);
  return r ? r.n : 0;
}

const fmtLeft = (ms) => {
  const h = Math.ceil(ms / HOUR);
  if (h >= 48) return `${Math.ceil(h / 24)} kun`;
  if (h >= 1) return `${h} soat`;
  return `${Math.max(1, Math.ceil(ms / 60000))} daqiqa`;
};

async function eligibility(userId, s) {
  const u = await db.prepare(
    'SELECT created_at, pin_hash, frozen, frozen_until FROM users WHERE id = ?'
  ).get(userId);
  const hist = await history(userId, s);
  const now = Date.now();
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok: !!ok, detail: ok ? null : detail });

  // 1) Akkaunt yoshi
  const ageMs = now - (parseTs(u && u.created_at) || now);
  const needAgeMs = s.credit_min_account_days * DAY;
  add('account_age', `Akkaunt kamida ${s.credit_min_account_days} kunlik`, ageMs >= needAgeMs,
    `Akkauntingiz kamida ${s.credit_min_account_days} kunlik bo'lishi kerak (yana ${fmtLeft(needAgeMs - ageMs)})`);

  // 2) Faollik
  const act = await activityCount(userId);
  add('activity', `Kamida ${s.credit_min_activity} ta xarid yoki tranzaksiya`, act >= s.credit_min_activity,
    `Kamida ${s.credit_min_activity} ta xarid yoki tranzaksiya kerak (hozir ${act} ta)`);

  // 3) Faol kredit / kutayotgan so'rov yo'q
  const active = await db.prepare("SELECT id FROM user_credits WHERE user_id = ? AND status = 'active'").get(userId);
  const pending = await db.prepare("SELECT id FROM credit_requests WHERE user_id = ? AND status = 'pending'").get(userId);
  add('no_active', "Faol kredit yoki kutayotgan so'rov yo'q", !active && !pending,
    active ? "Sizda faol kredit bor. Avval uni to'lang" : "Sizda javob kutayotgan so'rov bor. Avval uni yakunlang yoki bekor qiling");

  // 4) Sovutish davri
  const coolMs = s.credit_cooldown_hours * HOUR;
  const coolLeft = hist.lastClosedAt ? hist.lastClosedAt + coolMs - now : 0;
  add('cooldown', `Oldingi kreditdan keyin ${s.credit_cooldown_hours} soat o'tgan`, coolMs === 0 || coolLeft <= 0,
    `Oldingi kredit yopilgandan keyin ${s.credit_cooldown_hours} soat kutish kerak (yana ${fmtLeft(coolLeft)})`);

  // 5) Yaqinda kechikish bo'lmagan
  const fineMs = s.credit_recent_fine_days * DAY;
  const fineLeft = hist.lastFineAt ? hist.lastFineAt + fineMs - now : 0;
  add('no_recent_fines', `Oxirgi ${s.credit_recent_fine_days} kunda to'lov kechiktirilmagan`, fineMs === 0 || fineLeft <= 0,
    `Yaqinda to'lovni kechiktirgansiz. Yana ${fmtLeft(fineLeft)} dan keyin kredit olishingiz mumkin`);

  // 6) PIN
  add('has_pin', "Tranzaksiya PIN o'rnatilgan", !!(u && u.pin_hash),
    "Kredit olish uchun avval tranzaksiya PIN o'rnating (Profil > Xavfsizlik)");

  // 7) Hisob muzlatilmagan
  add('not_frozen', 'Hisob muzlatilmagan', !security.isFrozenRow(u),
    "Hisobingiz muzlatilgan. Profil > Xavfsizlik bo'limidan yoqing");

  // 8) Urinishlar limiti va rad etilgandan keyingi pauza
  const since = sqlTs(now - DAY);
  const cnt = await db.prepare(
    "SELECT COUNT(*) AS c FROM credit_requests WHERE user_id = ? AND REPLACE(REPLACE(SUBSTR(created_at, 1, 19), 'T', ' '), 'Z', '') >= ?"
  ).get(userId, since);
  const attemptsLeft = Math.max(0, s.credit_daily_attempts - cnt.c);
  const lastRej = await db.prepare(
    "SELECT responded_at FROM credit_requests WHERE user_id = ? AND status = 'rejected' ORDER BY id DESC LIMIT 1"
  ).get(userId);
  const pauseMs = s.credit_reject_pause_minutes * 60000;
  const pauseLeft = lastRej && lastRej.responded_at ? parseTs(lastRej.responded_at) + pauseMs - now : 0;
  add('attempts', `Bugungi urinishlar tugamagan (kuniga ${s.credit_daily_attempts} ta)`, attemptsLeft > 0 && pauseLeft <= 0,
    pauseLeft > 0
      ? `So'rov rad etilgan. Yangi so'rov uchun ${fmtLeft(pauseLeft)} kuting`
      : `Bugungi urinishlar tugadi (kuniga ${s.credit_daily_attempts} ta). Keyinroq urinib ko'ring`);

  return {
    checks, all_ok: checks.every(c => c.ok), hist, level: hist.level,
    rating: { name: ratingName(hist.level), level: hist.level, clean_paid: hist.cleanPaid },
    attempts_left: attemptsLeft,
  };
}

// ---------- Kafil talablari ----------
async function sharedIp(a, b) {
  const since = sqlTs(Date.now() - 30 * DAY);
  const r = await db.prepare(`
    SELECT 1 AS x FROM login_history la JOIN login_history lb ON la.ip = lb.ip
    WHERE la.user_id = ? AND lb.user_id = ? AND la.success = 1 AND lb.success = 1
      AND la.ip IS NOT NULL AND la.ip != '' AND la.created_at >= ? AND lb.created_at >= ?
    LIMIT 1
  `).get(a, b, since, since);
  return !!r;
}

// g: users qatori (id, created_at, coin_balance, pin_hash). excludeRequestId — kafilning "kutayotgan" so'rovlar sonidan chiqariladi
async function guarantorChecks(borrowerId, g, amount, s, excludeRequestId) {
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok: !!ok, detail: ok ? null : detail });

  const ageMs = Date.now() - (parseTs(g.created_at) || Date.now());
  add('g_age', `Kafil akkaunti kamida ${s.credit_guarantor_min_days} kunlik`, ageMs >= s.credit_guarantor_min_days * DAY,
    `Bu foydalanuvchining akkaunti kafil bo'lish uchun yetarlicha eski emas (kamida ${s.credit_guarantor_min_days} kun kerak)`);

  const needBal = round2(amount * s.credit_guarantor_min_balance_percent / 100);
  add('g_balance', 'Kafilda yetarli coin bor', (g.coin_balance || 0) >= needBal,
    "Bu foydalanuvchida kafil bo'lish uchun yetarli coin yo'q");

  const active = await db.prepare("SELECT COUNT(*) AS c FROM user_credits WHERE guarantor_id = ? AND status = 'active'").get(g.id);
  const pend = await db.prepare(
    "SELECT COUNT(*) AS c FROM credit_requests WHERE guarantor_id = ? AND status = 'pending' AND id != ?"
  ).get(g.id, excludeRequestId || 0);
  add('g_load', `Kafilning faol kafilliklari ${s.credit_guarantor_max_active} tadan kam`,
    active.c + pend.c < s.credit_guarantor_max_active,
    "Bu foydalanuvchi allaqachon boshqa kreditlarga kafil bo'lgan, boshqa kafil tanlang");

  add('g_pin', "Kafilda tranzaksiya PIN o'rnatilgan", !!g.pin_hash,
    "Bu foydalanuvchida tranzaksiya PIN o'rnatilmagan, shuning uchun tasdiqlay olmaydi");

  if (s.credit_block_same_ip) {
    add('g_ip', 'Kafil boshqa qurilma/IP dan kiradi', !(await sharedIp(borrowerId, g.id)),
      "Bu foydalanuvchi siz bilan bir IP/qurilmadan kirgan. Boshqa kafil tanlang");
  }
  return checks;
}

// ---------- Garov (gift) ----------
// Garovdagi gift user_gifts.trade_id = -(so'rov id) bilan band qilinadi: sotish, yuborish, trade, airdrop va pet
// ovqati kabi barcha joylar trade_id'ni tekshirgani uchun gift o'z-o'zidan qulflanadi.
const collateralRequired = (amt, s) => s.credit_collateral_required_amount > 0 && amt >= s.credit_collateral_required_amount;
const collateralMinValue = (amt, s) => round2(amt * s.credit_collateral_value_percent / 100);

async function validateCollateral(userId, ugId, amt, s) {
  const id = parseInt(ugId, 10);
  if (!id) return { ok: false, error: "Garov uchun gift noto'g'ri tanlangan" };
  const g = await db.prepare(`
    SELECT ug.id, ug.user_id, ug.trade_id, COALESCE(v.name, g.name) AS name, COALESCE(v.price, g.price) AS value
    FROM user_gifts ug JOIN gifts g ON g.id = ug.gift_id LEFT JOIN gift_variants v ON v.id = ug.variant_id
    WHERE ug.id = ?
  `).get(id);
  if (!g || g.user_id !== userId) return { ok: false, error: 'Garov uchun tanlangan gift inventaringizda topilmadi' };
  if (g.trade_id) return { ok: false, error: "Bu gift band (Trade yoki boshqa garovda). Boshqa gift tanlang" };
  const need = collateralMinValue(amt, s);
  if (g.value + 0.005 < need) return { ok: false, error: `Garov giftining narxi kamida ${need} coin bo'lishi kerak (${g.name}: ${g.value} coin)` };
  return { ok: true, gift: g };
}

async function releaseForRequest(requestId) {
  await db.prepare('UPDATE user_gifts SET trade_id = NULL WHERE trade_id = ?').run(-Math.abs(requestId));
}

async function releaseGiftById(userGiftId) {
  if (!userGiftId) return;
  await db.prepare('UPDATE user_gifts SET trade_id = NULL WHERE id = ? AND trade_id < 0').run(userGiftId);
}

// Kredit "defaulted" bo'lganda garov saytga o'tadi (gift qarzdor inventaridan o'chiriladi)
async function forfeitCollateral(credit) {
  if (!credit || !credit.collateral_user_gift_id) return;
  const ug = await db.prepare(`
    SELECT ug.id, COALESCE(v.name, g.name) AS name FROM user_gifts ug
    JOIN gifts g ON g.id = ug.gift_id LEFT JOIN gift_variants v ON v.id = ug.variant_id
    WHERE ug.id = ? AND ug.user_id = ? AND ug.trade_id < 0
  `).get(credit.collateral_user_gift_id, credit.user_id);
  if (!ug) return;
  await db.withTx(async (tx) => {
    await tx.prepare('DELETE FROM profile_pins WHERE user_gift_id = ?').run(ug.id);
    await tx.prepare('DELETE FROM user_gifts WHERE id = ? AND trade_id < 0').run(ug.id);
    await tx.prepare("UPDATE user_credits SET collateral_status = 'forfeited' WHERE id = ?").run(credit.id);
  });
  push.notifyUser(credit.user_id, {
    title: '🔒 Garov saytga o\'tdi',
    body: `Kreditni to'lamaganingiz uchun garovdagi "${ug.name}" giftingiz saytga o'tdi.`,
    url: '/index.html#kreditlar', tag: `collateral-forfeit-${credit.id}`, category: 'credit',
  });
}

// ---------- Muddati o'tgan so'rovlar ----------
// Qarzdor "Qabul qilaman" tugmasini muddatida bosmasa, so'rov bekor bo'ladi va garov bo'shatiladi.
async function sweepExpired() {
  const nowIso = new Date().toISOString();
  const rows = await db.prepare(
    "SELECT id, user_id FROM credit_requests WHERE status = 'pending' AND stage = 'borrower' AND stage_expires_at IS NOT NULL AND stage_expires_at < ?"
  ).all(nowIso);
  for (const r of rows) {
    const claim = await db.prepare(
      "UPDATE credit_requests SET status = 'cancelled', responded_at = ? WHERE id = ? AND status = 'pending' AND stage = 'borrower'"
    ).run(nowIso, r.id);
    if (!claim.changes) continue;
    await releaseForRequest(r.id);
    push.notifyUser(r.user_id, {
      title: '⌛ Kredit so\'rovi bekor bo\'ldi',
      body: "Qabul qilish vaqti tugadi, kredit so'rovingiz bekor qilindi. Kerak bo'lsa, qaytadan so'rov yuboring.",
      url: '/index.html#kreditlar', tag: `credit-expired-${r.id}`, category: 'credit',
    });
  }
}

async function notifyAdmins(payload) {
  const admins = await db.prepare('SELECT id FROM users WHERE is_admin = 1').all();
  for (const a of admins) push.notifyUser(a.id, payload);
}

// ---------- Kredit coinini qulflash ----------
async function lockUntilIso(hours) {
  return new Date(Date.now() + hours * HOUR).toISOString();
}

async function requireNoCreditLock(req, res, next) {
  try {
    const u = await db.prepare('SELECT credit_lock_until FROM users WHERE id = ?').get(req.user.id);
    if (u && u.credit_lock_until) {
      const ms = parseTs(u.credit_lock_until) - Date.now();
      if (ms > 0) {
        return res.status(403).json({
          error: `Kredit coinlari qulflangan: jo'natish va trade ${fmtLeft(ms)} dan keyin ochiladi (do'konda xarid qilish mumkin)`,
          credit_locked: true, credit_lock_until: new Date(parseTs(u.credit_lock_until)).toISOString(),
        });
      }
    }
    next();
  } catch (e) {
    console.error('Kredit qulfi tekshiruvi xatosi:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

// ---------- PIN (so'rov ichida, oldin hamma narsa tekshirilgandan keyin) ----------
// true — PIN to'g'ri; false — javob allaqachon yuborilgan (PIN kerak / xato / bloklangan)
function pinGate(req, res) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    res.once('finish', () => finish(false));
    res.once('close', () => finish(false));
    security.requirePin(req, res, () => finish(true));
  });
}

module.exports = {
  DAY, HOUR, round2, SETTING_DEFS, DEFAULTS,
  getSettings, settingsForAdmin, saveSettings, publicRules,
  history, ratingName, typesWithAccess, effectiveInterest, computeTerms,
  eligibility, guarantorChecks,
  collateralRequired, collateralMinValue, validateCollateral,
  releaseForRequest, releaseGiftById, forfeitCollateral,
  sweepExpired, notifyAdmins, lockUntilIso, requireNoCreditLock, pinGate, fmtLeft,
};
