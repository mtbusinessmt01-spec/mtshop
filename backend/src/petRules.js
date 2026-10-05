// Pet qoidalari — barcha raqamlar va hisob-kitoblar SHU YERDA (DB'ga bog'liq emas).
// pets.js (route'lar) va push.js (eslatmalar) ikkalasi shu moduldan foydalanadi.

const HOUR_MS = 60 * 60 * 1000;

// ---- Ochlik bosqichlari (oxirgi ovqatlanishdan boshlab) ----
const HUNGRY_AFTER_MS = 8 * HOUR_MS;    // 8 soatdan keyin och  (daromad 50%)
const SICK_AFTER_MS = 24 * HOUR_MS;     // 24 soatdan keyin kasal (daromad yo'q, davolash mumkin)
const DEATH_AFTER_MS = 72 * HOUR_MS;    // 72 soatdan keyin o'ladi
const HUNGRY_INCOME_FACTOR = 0.5;

// ---- Daromad ----
const INCOME_INTERVAL_MS = 3 * HOUR_MS;
const LEVEL_BONUS_PER_LEVEL = 0.05;     // har LV uchun +5%
const MAX_LEVEL_BONUS = 0.8;            // eng ko'pi bilan +80% (LV 17 da to'ladi)

// ---- Narxlar ----
const HEAL_RATE = 0.10;                 // davolash = pet narxining 10%
const HEAL_MIN_COST = 25;               // ... lekin kamida 25 coin
const REVIVE_RATE = 0.5;                // tiriltirish = pet narxining 50%
const REVIVE_WINDOW_MS = 7 * 24 * HOUR_MS; // o'lgandan keyin 7 kun ichida tiriltirish mumkin

// ---- Saytga qayta sotish ----
// Boshlang'ich narx = pet narxining 50%. Daromad bonusi 80% ga yetgach (LV 17),
// har keyingi LV uchun +5% (pet narxidan) qo'shiladi, eng ko'pi bilan 150%.
const SELL_BASE_RATE = 0.5;
const SELL_RATE_PER_LEVEL_AFTER_CAP = 0.05;
const SELL_MAX_RATE = 1.5;

const round2 = (n) => Math.round(n * 100) / 100;

// "2026-09-18T08:39:40.000Z" (ISO) va "2026-09-18 08:39:40" (SQLite, UTC) ikkalasini bir xil o'qiydi
function parseTs(str) {
  if (!str) return NaN;
  const s = String(str);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').getTime();
}

// 'full' | 'hungry' | 'sick' | 'dead'
function stageFor(elapsedMs) {
  if (elapsedMs >= DEATH_AFTER_MS) return 'dead';
  if (elapsedMs >= SICK_AFTER_MS) return 'sick';
  if (elapsedMs >= HUNGRY_AFTER_MS) return 'hungry';
  return 'full';
}

function levelBonus(level) {
  return Math.min(MAX_LEVEL_BONUS, Math.max(0, (level - 1) * LEVEL_BONUS_PER_LEVEL));
}

// Bonus maksimumga yetadigan LV (hozir 17)
const BONUS_CAP_LEVEL = Math.round(MAX_LEVEL_BONUS / LEVEL_BONUS_PER_LEVEL) + 1;

function incomeFactor(stage) {
  if (stage === 'full') return 1;
  if (stage === 'hungry') return HUNGRY_INCOME_FACTOR;
  return 0;
}

// Hozirgi paytda har 3 soatda tushadigan coin
function incomePer3h(coinPer3h, level, stage) {
  return round2(coinPer3h * (1 + levelBonus(level)) * incomeFactor(stage));
}

// Har bir 3 soatlik interval o'sha paytdagi ochlik bosqichiga qarab alohida hisoblanadi
// (foydalanuvchi uzoq kirmagan bo'lsa ham to'g'ri chiqadi).
function accrueIncome({ lastFedMs, lastIncomeMs, nowMs, coinPer3h, level }) {
  const intervals = Math.max(0, Math.floor((nowMs - lastIncomeMs) / INCOME_INTERVAL_MS));
  const mult = 1 + levelBonus(level);
  let coin = 0;
  for (let k = 1; k <= Math.min(intervals, 500); k++) {
    const t = lastIncomeMs + k * INCOME_INTERVAL_MS;
    const elapsed = Math.max(0, t - lastFedMs);
    if (elapsed >= SICK_AFTER_MS) break; // keyingilari ham kasal — daromad yo'q
    coin += coinPer3h * mult * (elapsed < HUNGRY_AFTER_MS ? 1 : HUNGRY_INCOME_FACTOR);
  }
  return { coin: round2(coin), advancedMs: lastIncomeMs + intervals * INCOME_INTERVAL_MS };
}

function requiredFeedXp(petType, level) {
  return Math.max((petType.xp_to_feed_full || 0) - level * 0.2, 0.1);
}

// Proporsional ovqatlantirish: XP to'yish uchun kerakli miqdorning qancha qismini bersa,
// ochlik vaqti shuncha qismga qisqaradi. To'liq to'ydirsa — vaqt 0 dan boshlanadi.
function applyFeed({ elapsedMs, xpGained, requiredXp }) {
  const fraction = Math.min(1, Math.max(0, xpGained / requiredXp));
  return { fraction, newElapsedMs: Math.max(0, elapsedMs * (1 - fraction)) };
}

function healCost(price) {
  return round2(Math.max(HEAL_MIN_COST, (price || 0) * HEAL_RATE));
}

function reviveCost(price) {
  return round2((price || 0) * REVIVE_RATE);
}

function sellPrice(price, level) {
  const extra = Math.max(0, level - BONUS_CAP_LEVEL) * SELL_RATE_PER_LEVEL_AFTER_CAP;
  return round2((price || 0) * Math.min(SELL_MAX_RATE, SELL_BASE_RATE + extra));
}

module.exports = {
  HOUR_MS, HUNGRY_AFTER_MS, SICK_AFTER_MS, DEATH_AFTER_MS, INCOME_INTERVAL_MS, REVIVE_WINDOW_MS,
  HUNGRY_INCOME_FACTOR, MAX_LEVEL_BONUS, BONUS_CAP_LEVEL,
  round2, parseTs, stageFor, levelBonus, incomeFactor, incomePer3h, accrueIncome,
  requiredFeedXp, applyFeed, healCost, reviveCost, sellPrice,
};
