// Promokod tizimi testlari (backend, haqiqiy HTTP orqali).
// OGOHLANTIRISH: faqat bo'sh TEST bazasida ishlating. tough-cookie kerak: npm i --no-save tough-cookie
//   export TURSO_DATABASE_URL=file:/tmp/promo-test.db JWT_SECRET=test PORT=4445
//   node src/seed-admin.js admin admin123 && node src/server.js &
//   node tests/promocodes.test.js
const { createClient } = require('@libsql/client');
const { CookieJar } = require('tough-cookie');
const B = process.env.TEST_URL || 'http://localhost:4445';
const raw = createClient({ url: process.env.TEST_DB || 'file:/tmp/promo-test.db' });
const q = async (sql, args = []) => { const r = await raw.execute({ sql, args }); return r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))); };
let pass = 0, fail = 0; const out = [];
const check = (n, c, x) => { c ? pass++ : fail++; out.push((c ? '  ✅ ' : '  ❌ ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };

class Cl {
  constructor() { this.jar = new CookieJar(); }
  async call(method, path, body) {
    const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', Cookie: this.jar.getCookieStringSync(B) }, body: body === undefined ? undefined : JSON.stringify(body) });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => this.jar.setCookieSync(c, B));
    let d = null; try { d = await r.json(); } catch (e) {} return { s: r.status, d };
  }
  get(p) { return this.call('GET', p); } post(p, b) { return this.call('POST', p, b || {}); }
  put(p, b) { return this.call('PUT', p, b || {}); } del(p) { return this.call('DELETE', p); }
}
const login = async (u, p) => { const c = new Cl(); const r = await c.post('/api/auth/login', { username: u, password: p }); if (r.s !== 200) throw new Error('login ' + u); return c; };

(async () => {
  const admin = await login('admin', 'admin123');
  const mkUser = async (n) => { const r = await admin.post('/api/admin/users', { username: n, password: n + '123' }); return { id: r.d.id, c: await login(n, n + '123'), name: n }; };
  const bal = async (u) => (await q('SELECT coin_balance FROM users WHERE id = ?', [u.id]))[0].coin_balance;
  const u1 = await mkUser('pt_ali'), u2 = await mkUser('pt_vali'), u3 = await mkUser('pt_sami');
  const redeem = (u, code) => u.c.post('/api/promocodes/redeem', { code });

  out.push('1) Coin promokod, limit 2');
  let r = await admin.post('/api/admin/promocodes', { code: 'coin50', coin_amount: 50, max_uses: 2 });
  check('admin yaratdi (kod KATTA harfga o\'tdi)', r.s === 200 && r.d.code === 'COIN50', r);
  r = await redeem(u1, '  coin50 ');
  check('kichik harf va bo\'sh joy bilan ishladi', r.s === 200 && r.d.coin_balance === 50, r);
  check('balans bazada +50', (await bal(u1)) === 50);
  r = await redeem(u1, 'COIN50');
  check('o\'sha foydalanuvchi 2-marta ishlata olmaydi (409)', r.s === 409, r);
  check('2-urinishdan balans o\'zgarmadi', (await bal(u1)) === 50);
  r = await redeem(u2, 'COIN50');
  check('2-foydalanuvchi ishlatdi', r.s === 200, r);
  r = await redeem(u3, 'COIN50');
  check('limit tugadi (3-foydalanuvchi rad)', r.s === 404 && /limit/i.test(r.d.error), r);
  check('3-foydalanuvchi balansi 0', (await bal(u3)) === 0);

  out.push('2) Gift + case + coin, soni cheklangan gift');
  const gq = await admin.post('/api/admin/gifts', { name: 'Promo gift', price: 120, quantity: 5 });
  const gid = gq.d.id;
  const cs = await q("INSERT INTO cases (name, price) VALUES ('Promo case', 10) RETURNING id");
  const cid = cs[0].id;
  r = await admin.post('/api/admin/promocodes', { code: 'MIX', coin_amount: 10, items: [{ item_type: 'gift', item_id: gid, quantity: 2 }, { item_type: 'case', item_id: cid, quantity: 3 }] });
  check('aralash promokod yaratildi', r.s === 200, r);
  r = await redeem(u1, 'mix');
  check('ishlatildi, 3 xil mukofot qaytdi', r.s === 200 && r.d.rewards.length === 3, r);
  check('inventarga 2 ta gift tushdi', (await q('SELECT COUNT(*) n FROM user_gifts WHERE user_id=? AND gift_id=?', [u1.id, gid]))[0].n === 2);
  check('gift bought_price joriy narx (120)', (await q('SELECT bought_price b FROM user_gifts WHERE user_id=? AND gift_id=? LIMIT 1', [u1.id, gid]))[0].b === 120);
  check('inventarga 3 ta case tushdi', (await q('SELECT COUNT(*) n FROM user_cases WHERE user_id=? AND case_id=?', [u1.id, cid]))[0].n === 3);
  check('shop\'dagi gift soni kamaymadi (5)', (await q('SELECT quantity FROM gifts WHERE id=?', [gid]))[0].quantity === 5);
  check('coin +10', (await bal(u1)) === 60);

  out.push('3) Faol emas / muddati tugagan');
  r = await admin.post('/api/admin/promocodes', { code: 'OFFLINE', coin_amount: 5 });
  await admin.put(`/api/admin/promocodes/${r.d.id}/active`, { active: false });
  r = await redeem(u2, 'OFFLINE');
  check('faol bo\'lmagan kod rad etildi', r.s === 404 && /faol/.test(r.d.error), r);
  const pid = (await q("SELECT id FROM promo_codes WHERE code='OFFLINE'"))[0].id;
  await admin.put(`/api/admin/promocodes/${pid}/active`, { active: true });
  r = await redeem(u2, 'OFFLINE');
  check('qayta yoqilgach ishladi', r.s === 200, r);
  await q("INSERT INTO promo_codes (code, coin_amount, expires_at) VALUES ('OLD', 5, '2020-01-01T00:00:00.000Z')");
  r = await redeem(u3, 'OLD');
  check('muddati o\'tgan kod rad etildi', r.s === 404 && /muddati/.test(r.d.error), r);
  r = await admin.post('/api/admin/promocodes', { code: 'PAST', coin_amount: 5, expires_at: '2020-01-01T00:00' });
  check('admin o\'tmishdagi muddat kirita olmaydi', r.s === 400, r);

  out.push('4) Parallel so\'rovlar (race condition)');
  await admin.post('/api/admin/promocodes', { code: 'ONE', coin_amount: 7, max_uses: 1 });
  const racers = await Promise.all([1, 2, 3, 4, 5].map(i => mkUser('pt_r' + i)));
  const rs = await Promise.all(racers.map(u => redeem(u, 'ONE')));
  check('limit 1 bo\'lsa, 5 ta parallel so\'rovdan aynan 1 tasi o\'tdi', rs.filter(x => x.s === 200).length === 1, rs.map(x => x.s));
  check('used_count = 1', (await q("SELECT used_count u FROM promo_codes WHERE code='ONE'"))[0].u === 1);
  await admin.post('/api/admin/promocodes', { code: 'SAME', coin_amount: 9 });
  const dbl = await Promise.all([redeem(u3, 'SAME'), redeem(u3, 'SAME'), redeem(u3, 'SAME')]);
  check('bitta foydalanuvchi parallel 3 marta bossa, 1 marta oladi', dbl.filter(x => x.s === 200).length === 1, dbl.map(x => x.s));
  check('balans aynan +9', (await bal(u3)) === 9);

  out.push('5) O\'chirilgan gift — hech narsa berilmaydi (ROLLBACK)');
  const g2 = (await admin.post('/api/admin/gifts', { name: 'Vaqtincha', price: 30, unlimited: true })).d.id;
  await admin.post('/api/admin/promocodes', { code: 'GONE', coin_amount: 99, items: [{ item_type: 'gift', item_id: g2, quantity: 1 }] });
  await q('DELETE FROM gifts WHERE id = ?', [g2]);
  const before = await bal(u2);
  r = await redeem(u2, 'GONE');
  check('xato qaytdi (409)', r.s === 409, r);
  check('coin berilmadi', (await bal(u2)) === before);
  check('used_count oshmadi', (await q("SELECT used_count u FROM promo_codes WHERE code='GONE'"))[0].u === 0);
  check('redemption yozilmadi', (await q("SELECT COUNT(*) n FROM promo_redemptions WHERE promo_id=(SELECT id FROM promo_codes WHERE code='GONE')"))[0].n === 0);

  out.push('6) Validatsiya va ruxsat');
  r = await admin.post('/api/admin/promocodes', { code: 'EMPTY' });
  check('mukofotsiz promokod rad etildi', r.s === 400, r);
  r = await admin.post('/api/admin/promocodes', { code: 'COIN50', coin_amount: 1 });
  check('takroriy kod rad etildi (409)', r.s === 409, r);
  r = await admin.post('/api/admin/promocodes', { code: 'a b', coin_amount: 1 });
  check('bo\'sh joyli kod rad etildi', r.s === 400, r);
  r = await admin.post('/api/admin/promocodes', { coin_amount: 3 });
  check('kod kiritilmasa avtomatik yaratiladi', r.s === 200 && /^[A-Z0-9]{8}$/.test(r.d.code), r);
  r = await admin.post('/api/admin/promocodes', { code: 'NEG', coin_amount: -5 });
  check('manfiy coin rad etildi', r.s === 400, r);
  r = await admin.post('/api/admin/promocodes', { code: 'BIGQ', items: [{ item_type: 'gift', item_id: gid, quantity: 999 }] });
  check('juda katta miqdor rad etildi', r.s === 400, r);
  r = await admin.post('/api/admin/promocodes', { code: 'NOGIFT', items: [{ item_type: 'gift', item_id: 999999, quantity: 1 }] });
  check('mavjud bo\'lmagan gift rad etildi', r.s === 404, r);
  r = await u1.c.post('/api/admin/promocodes', { code: 'HACK', coin_amount: 1000000 });
  check('oddiy foydalanuvchi yarata olmaydi (403)', r.s === 403, r);
  r = await u1.c.get('/api/admin/promocodes');
  check('oddiy foydalanuvchi ro\'yxatni ko\'ra olmaydi (403)', r.s === 403, r);
  r = await new Cl().post('/api/promocodes/redeem', { code: 'MIX' });
  check('kirmagan foydalanuvchi ishlata olmaydi (401)', r.s === 401, r);
  r = await redeem(u1, '');
  check('bo\'sh kod rad etildi', r.s === 400, r);

  out.push('7) Admin ro\'yxat, tarix, o\'chirish');
  r = await admin.get('/api/admin/promocodes');
  const mix = r.d.find(p => p.code === 'MIX');
  check('ro\'yxatda MIX bor va 2 ta mukofot bilan', r.s === 200 && mix && mix.items.length === 2 && mix.items[0].gift_name === 'Promo gift', mix);
  r = await admin.get(`/api/admin/promocodes/${mix.id}/redemptions`);
  check('tarixda @pt_ali ko\'rinadi', r.s === 200 && r.d.length === 1 && r.d[0].username === 'pt_ali', r);
  r = await admin.del(`/api/admin/promocodes/${mix.id}`);
  check('o\'chirildi', r.s === 200, r);
  r = await redeem(u2, 'MIX');
  check('o\'chirilgan kod ishlamaydi', r.s === 404, r);
  check('o\'chirilgach bog\'liq yozuvlar ham yo\'q', (await q('SELECT COUNT(*) n FROM promo_code_items WHERE promo_id=?', [mix.id]))[0].n === 0);

  out.push('8) Taxmin qilishdan himoya');
  const brute = await mkUser('pt_brute');
  let last; for (let i = 0; i < 10; i++) last = await redeem(brute, 'WRONG' + i);
  check('8 ta xatodan keyin bloklanadi (429)', last.s === 429, last);
  r = await redeem(brute, 'SAME');
  check('blok paytida to\'g\'ri kod ham vaqtincha rad etiladi', r.s === 429, r);

  console.log(out.join('\n'));
  console.log(`\nNatija: ${pass} o'tdi, ${fail} xato`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(1); });
