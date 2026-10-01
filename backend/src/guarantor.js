// Kafil (kafolat) tizimi: qarzdor to'lamasa kafilga xabar beriladi, kafil 2 sutkada
// qarzdorga eslatishi kerak; 2 sutkada ham to'lanmasa kafildan shu hafta to'lovining 50% olinadi.
const db = require('./db');
const push = require('./push');

const FINE_RATE = 0.12; // kredit summasining 12% (kechikkan har hafta uchun)
const MAX_FINES = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const GUARANTOR_DEADLINE_MS = 2 * 24 * 60 * 60 * 1000; // kafilga beriladigan vaqt: 2 sutka
const GUARANTOR_PENALTY_RATE = 0.5;                    // shu hafta to'lovining 50%
const REMIND_COOLDOWN_MS = 60 * 60 * 1000;             // qarzdorga qayta eslatish uchun kutish: 1 soat
const CHECK_INTERVAL_MS = 5 * 60 * 1000;               // fon tekshiruvi: har 5 daqiqada
const MIN_ON_DEMAND_GAP_MS = 60 * 1000;                // so'rov bilan chaqirilganda: kamida 1 daqiqa oralig'i

const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Jarima mexanizmi (credits.js dan ko'chirildi, xulq-atvori o'zgarmagan) ----------
// Foydalanuvchining faol kreditlarini tekshirib, muddati o'tgan to'lovlar uchun 12% jarima qo'shadi,
// 3 martadan keyin bloklaydi. Kreditda kafil bo'lsa, har kechikkan hafta uchun kafilga ham xabar beriladi.
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
    const missed = []; // kafil uchun: kechikkan to'lovlar

    while (now > next && fineCount < MAX_FINES && remaining > 0) {
      missed.push({
        due: new Date(next).toISOString(),
        amount: round2(Math.min(credit.weekly_payment, remaining)),
      });
      const fine = round2(credit.principal_amount * FINE_RATE);
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

      if (credit.guarantor_id) {
        for (const m of missed) {
          try { await createOverdue(credit, m.due, m.amount); }
          catch (e) { console.error('Kafil uchun yozuv yaratishda xato:', e.message); }
        }
      }
    }
  }
}

// ---------- Kechikish yozuvi va kafilga xabar ----------
async function createOverdue(credit, dueIso, weekAmount) {
  const guarantor = await db.prepare('SELECT id FROM users WHERE id = ?').get(credit.guarantor_id);
  if (!guarantor || weekAmount <= 0) return;

  const penalty = round2(weekAmount * GUARANTOR_PENALTY_RATE);
  const deadline = new Date(Date.now() + GUARANTOR_DEADLINE_MS).toISOString();

  const r = await db.prepare(`
    INSERT OR IGNORE INTO guarantor_overdues
      (user_credit_id, borrower_id, guarantor_id, week_payment, penalty_amount, due_at, deadline_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(credit.id, credit.user_id, credit.guarantor_id, weekAmount, penalty, dueIso, deadline);
  if (!r.changes) return; // bu hafta uchun allaqachon yozilgan

  const borrower = await db.prepare('SELECT username FROM users WHERE id = ?').get(credit.user_id);
  push.notifyUser(credit.guarantor_id, {
    title: '⚠️ Qarzdor to\'lamadi',
    body: `@${borrower?.username || 'qarzdor'} kredit to'lovini kechiktirdi. 2 sutka ichida unga to'lash haqida xabar bering, aks holda hisobingizdan ${penalty} coin (to'lovning 50%) yechiladi.`,
    url: '/index.html#kreditlar',
    tag: `guarantor-overdue-${r.lastInsertRowid}`,
  });
}

// ---------- Natijani hal qilish: qarzdor to'ladimi yoki kafildan yechiladimi ----------
async function resolveOverdue(o) {
  const nowIso = new Date().toISOString();
  const credit = await db.prepare('SELECT * FROM user_credits WHERE id = ?').get(o.user_credit_id);
  if (!credit) {
    await db.prepare("UPDATE guarantor_overdues SET status = 'void', resolved_at = ? WHERE id = ? AND status = 'waiting'").run(nowIso, o.id);
    return;
  }

  // Qarzdor kechikkan to'lovdan keyin yetarli summa to'laganmi (yoki kreditni to'liq yopganmi)?
  const dueMs = push.parseDate(o.due_at);
  const payments = await db.prepare('SELECT amount, created_at FROM credit_payments WHERE user_credit_id = ?').all(o.user_credit_id);
  const paidSum = payments
    .filter(p => push.parseDate(p.created_at) >= dueMs - 1000)
    .reduce((sum, p) => sum + p.amount, 0);

  if (credit.status === 'paid' || paidSum + 0.005 >= o.week_payment) {
    await db.prepare("UPDATE guarantor_overdues SET status = 'paid', resolved_at = ? WHERE id = ? AND status = 'waiting'").run(nowIso, o.id);
    return;
  }

  if (Date.now() < push.parseDate(o.deadline_at)) return; // hali 2 sutka o'tmagan

  // Muddat tugadi, to'lanmadi — kafildan olinadi. Avval holatni "charged" qilib olamiz (ikki marta yechilmasligi uchun)
  const claim = await db.prepare(
    "UPDATE guarantor_overdues SET status = 'charged', resolved_at = ? WHERE id = ? AND status = 'waiting'"
  ).run(nowIso, o.id);
  if (!claim.changes) return;

  const guarantor = await db.prepare('SELECT id FROM users WHERE id = ?').get(o.guarantor_id);
  if (!guarantor) {
    await db.prepare("UPDATE guarantor_overdues SET status = 'void', charged_amount = 0 WHERE id = ?").run(o.id);
    return;
  }

  // Kafilning balansi yetmasa, borini yechamiz (balans manfiy bo'lib ketmaydi)
  let charged = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await db.prepare('SELECT coin_balance FROM users WHERE id = ?').get(o.guarantor_id);
    const available = Math.floor(Math.max(0, fresh.coin_balance) * 100) / 100;
    const take = Math.min(o.penalty_amount, available);
    if (take <= 0) break;
    const r = await db.prepare(
      'UPDATE users SET coin_balance = coin_balance - ? WHERE id = ? AND coin_balance >= ?'
    ).run(take, o.guarantor_id, take);
    if (r.changes) { charged = take; break; }
  }
  await db.prepare('UPDATE guarantor_overdues SET charged_amount = ? WHERE id = ?').run(charged, o.id);

  const borrower = await db.prepare('SELECT username FROM users WHERE id = ?').get(o.borrower_id);
  push.notifyUser(o.guarantor_id, {
    title: '💸 Kafillik jarimasi',
    body: `@${borrower?.username || 'qarzdor'} 2 sutkada to'lamadi. Hisobingizdan ${charged} coin (shu hafta to'lovining 50%) yechildi.`,
    url: '/index.html#kreditlar',
    tag: `guarantor-charged-${o.id}`,
  });
}

// ---------- Fon tekshiruvi ----------
let running = false;
let lastRunAt = 0;

async function runGuarantorChecks() {
  if (running) return;
  running = true;
  try {
    // 1) Qarzdor saytga kirmagan bo'lsa ham kechikishni aniqlaymiz
    const overdueUsers = await db.prepare(`
      SELECT DISTINCT user_id FROM user_credits
      WHERE status = 'active' AND guarantor_id IS NOT NULL AND next_payment_at < ?
    `).all(new Date().toISOString());
    for (const r of overdueUsers) await applyOverdueFines(r.user_id);

    // 2) Kutilayotgan kechikishlarni hal qilamiz
    const waiting = await db.prepare("SELECT * FROM guarantor_overdues WHERE status = 'waiting'").all();
    for (const o of waiting) await resolveOverdue(o);
  } catch (e) {
    console.error('Kafil tekshiruvida xato:', e.message);
  } finally {
    running = false;
    lastRunAt = Date.now();
  }
}

// Foydalanuvchi so'rovlari paytida chaqiriladi (server uxlab qolgan bo'lsa ham holat yangilanadi)
async function maybeRunChecks() {
  if (Date.now() - lastRunAt < MIN_ON_DEMAND_GAP_MS) return;
  await runGuarantorChecks();
}

function startScheduler() {
  setTimeout(runGuarantorChecks, 20 * 1000);
  setInterval(runGuarantorChecks, CHECK_INTERVAL_MS);
}

module.exports = {
  applyOverdueFines, runGuarantorChecks, maybeRunChecks, startScheduler, REMIND_COOLDOWN_MS,
};
