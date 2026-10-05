// Pet qoidalari testlari (DB va server kerak emas):  node --test tests/petRules.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/petRules');

const H = R.HOUR_MS;

test('ochlik bosqichlari: 8 / 24 / 72 soat', () => {
  assert.equal(R.stageFor(0), 'full');
  assert.equal(R.stageFor(8 * H - 1), 'full');
  assert.equal(R.stageFor(8 * H), 'hungry');
  assert.equal(R.stageFor(24 * H - 1), 'hungry');
  assert.equal(R.stageFor(24 * H), 'sick');
  assert.equal(R.stageFor(72 * H - 1), 'sick');
  assert.equal(R.stageFor(72 * H), 'dead');
});

test('LV bonusi: har LV +5%, 80% dan oshmaydi (LV 17 da to\'ladi)', () => {
  assert.equal(R.levelBonus(1), 0);
  assert.equal(R.levelBonus(5), 0.2);
  assert.equal(R.levelBonus(R.BONUS_CAP_LEVEL), 0.8);
  assert.equal(R.BONUS_CAP_LEVEL, 17);
  assert.equal(R.levelBonus(18), 0.8);
  assert.equal(R.levelBonus(100), 0.8);
});

test('hozirgi daromad: bosqich va LV bonusi hisobga olinadi', () => {
  assert.equal(R.incomePer3h(10, 1, 'full'), 10);
  assert.equal(R.incomePer3h(10, 1, 'hungry'), 5);
  assert.equal(R.incomePer3h(10, 1, 'sick'), 0);
  assert.equal(R.incomePer3h(10, 5, 'full'), 12);       // +20%
  assert.equal(R.incomePer3h(10, 30, 'full'), 18);      // +80% (cheklangan)
  assert.equal(R.incomePer3h(10, 5, 'hungry'), 6);
});

test('daromad intervalma-interval hisoblanadi (to\'q -> och -> kasal)', () => {
  const t0 = Date.UTC(2026, 0, 1);
  // 30 soat o'tgan, oxirgi ovqatlanish t0, daromad ham t0 dan sanalgan: 10 interval (3s)
  const r = R.accrueIncome({ lastFedMs: t0, lastIncomeMs: t0, nowMs: t0 + 30 * H, coinPer3h: 10, level: 1 });
  // 3s,6s -> to'q (2 x 10); 9..21s -> och (5 x 5 = 25); 24s dan -> kasal (0)
  assert.equal(r.coin, 20 + 25);
  assert.equal(r.advancedMs, t0 + 30 * H);
});

test('daromad: ovqatlantirishdan keyingi intervallar to\'liq (manfiy vaqt 0 deb olinadi)', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const r = R.accrueIncome({ lastFedMs: t0 + 5 * H, lastIncomeMs: t0, nowMs: t0 + 6 * H, coinPer3h: 10, level: 1 });
  assert.equal(r.coin, 20);
});

test('daromad: LV bonusi qo\'llanadi', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const r = R.accrueIncome({ lastFedMs: t0, lastIncomeMs: t0, nowMs: t0 + 3 * H, coinPer3h: 10, level: 11 });
  assert.equal(r.coin, 15);   // +50%
});

test('proporsional ovqatlantirish', () => {
  const full = R.applyFeed({ elapsedMs: 20 * H, xpGained: 5, requiredXp: 5 });
  assert.equal(full.fraction, 1);
  assert.equal(full.newElapsedMs, 0);

  const over = R.applyFeed({ elapsedMs: 20 * H, xpGained: 50, requiredXp: 5 });
  assert.equal(over.newElapsedMs, 0);

  const half = R.applyFeed({ elapsedMs: 30 * H, xpGained: 2.5, requiredXp: 5 });
  assert.equal(half.fraction, 0.5);
  assert.equal(half.newElapsedMs, 15 * H);   // kasal (30s) -> yarim to'ydi (15s) -> sog'lom

  const none = R.applyFeed({ elapsedMs: 10 * H, xpGained: 0, requiredXp: 5 });
  assert.equal(none.newElapsedMs, 10 * H);
});

test('kerakli to\'yish XP: har LV da 0.2 kamayadi, 0.1 dan past emas', () => {
  const t = { xp_to_feed_full: 5 };
  assert.equal(R.round2(R.requiredFeedXp(t, 1)), 4.8);
  assert.equal(R.round2(R.requiredFeedXp(t, 10)), 3);
  assert.equal(R.requiredFeedXp(t, 100), 0.1);
});

test('davolash: narxning 10%, kamida 25', () => {
  assert.equal(R.healCost(100), 25);
  assert.equal(R.healCost(250), 25);
  assert.equal(R.healCost(1000), 100);
  assert.equal(R.healCost(1234.5), 123.45);
});

test('tiriltirish: narxning 50%', () => {
  assert.equal(R.reviveCost(1000), 500);
  assert.equal(R.reviveCost(333), 166.5);
});

test('saytga sotish: 50% dan boshlanadi, LV 17 dan keyin oshadi, 150% da to\'xtaydi', () => {
  assert.equal(R.sellPrice(1000, 1), 500);
  assert.equal(R.sellPrice(1000, 17), 500);      // bonus cheklovigacha o'zgarmaydi
  assert.equal(R.sellPrice(1000, 18), 550);
  assert.equal(R.sellPrice(1000, 27), 1000);
  assert.equal(R.sellPrice(1000, 37), 1500);
  assert.equal(R.sellPrice(1000, 500), 1500);
});

test('timestamp: ISO va SQLite formatlari bir xil o\'qiladi', () => {
  assert.equal(R.parseTs('2026-09-18T08:39:40.000Z'), R.parseTs('2026-09-18 08:39:40'));
  assert.ok(Number.isNaN(R.parseTs(null)));
});
