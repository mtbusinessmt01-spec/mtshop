// Kredit qoidalari testlari (backend, haqiqiy HTTP orqali).
// OGOHLANTIRISH: faqat bo'sh TEST bazasida ishlating. tough-cookie kerak: npm i --no-save tough-cookie
//   export TURSO_DATABASE_URL=file:/tmp/credit-test.db JWT_SECRET=test PORT=4447
//   node src/seed-admin.js admin admin123 && node src/server.js &
//   TEST_URL=http://localhost:4447 TEST_DB=file:/tmp/credit-test.db node tests/credit.test.js
const { createClient } = require('@libsql/client');
const { CookieJar } = require('tough-cookie');
const B = process.env.TEST_URL || 'http://localhost:4447';
const raw = createClient({ url: process.env.TEST_DB || 'file:/tmp/credit-test.db', timeout: 8000 });
const q = async (sql, args = []) => { const r = await raw.execute({ sql, args }); return r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))); };
let pass = 0, fail = 0; const out = [];
const check = (n, c, x) => { c ? pass++ : fail++; out.push((c ? '  ✅ ' : '  ❌ ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };

class Cl {
  constructor() { this.jar = new CookieJar(); }
  async call(method, path, body, headers = {}) {
    const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', Cookie: this.jar.getCookieStringSync(B), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => this.jar.setCookieSync(c, B));
    let d = null; try { d = await r.json(); } catch (e) {} return { s: r.status, d };
  }
  get(p) { return this.call('GET', p); } post(p, b, h) { return this.call('POST', p, b || {}, h); }
  put(p, b) { return this.call('PUT', p, b || {}); } del(p) { return this.call('DELETE', p); }
}
const login = async (u, p) => { const c = new Cl(); const r = await c.post('/api/auth/login', { username: u, password: p }); if (r.s !== 200) throw new Error('login ' + u); return c; };
const PIN = { 'X-Tx-Pin': '1234' };
let cheap;
const DAYS = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');

(async () => {
  const admin = await login('admin', 'admin123');
  const tag = Date.now().toString(36);
  const mkUser = async (n, { days = 30, balance = 0, pin = true, gifts = 3 } = {}) => {
    const name = `${n}_${tag}`;
    const r = await admin.post('/api/admin/users', { username: name, password: name + '123' });
    const u = { id: r.d.id, name, c: await login(name, name + '123') };
    await q('UPDATE users SET created_at = ?, coin_balance = ? WHERE id = ?', [DAYS(days), balance, u.id]);
    if (pin) await u.c.post('/api/security/pin', { password: name + '123', pin: '1234' });
    for (let i = 0; i < gifts; i++) await q('INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, 1)', [u.id, cheap]);
    return u;
  };
  const bal = async (u) => (await q('SELECT coin_balance FROM users WHERE id = ?', [u.id]))[0].coin_balance;
  const ageRequests = () => q("UPDATE credit_requests SET created_at = ?, responded_at = CASE WHEN responded_at IS NULL THEN NULL ELSE ? END", [DAYS(3), DAYS(3)]);
  const body = (type, amount, g, extra = {}) => ({ credit_type_id: type, amount, guarantor_username: g.name, terms_accepted: true, confirm_amount: String(amount), ...extra });

  // Tayyorgarlik: giftlar va kredit turlari
  cheap = (await q("INSERT INTO gifts (name, price) VALUES (?, 10) RETURNING id", ['arzon_' + tag]))[0].id;
  const pricey = (await q("INSERT INTO gifts (name, price) VALUES (?, 700) RETURNING id", ['qimmat_' + tag]))[0].id;
  const huge = (await q("INSERT INTO gifts (name, price) VALUES (?, 1500) RETURNING id", ['katta_' + tag]))[0].id;
  const mkType = async (name, min, max, interest, weeks) => (await admin.post('/api/admin/credit-types', { name, min_amount: min, max_amount: max, interest_percent: interest, installments_weeks: weeks })).d.id;
  const t1 = await mkType('Kichik_' + tag, 100, 300, 10, 2);
  const t2 = await mkType('Katta_' + tag, 300, 1200, 8, 4);

  // Sozlamalarni standartga qaytaramiz va IP tekshiruvini vaqtincha o'chiramiz (hamma test foydalanuvchilari bitta IP dan kiradi)
  await q("DELETE FROM app_settings WHERE key LIKE 'credit\\_%' ESCAPE '\\'");
  let r = await admin.put('/api/admin/credit-settings', { settings: { credit_block_same_ip: 0 } });
  check('admin sozlamani saqladi', r.s === 200 && r.d.find(x => x.key === 'credit_block_same_ip').value === 0, r);
  r = await admin.put('/api/admin/credit-settings', { settings: { credit_lock_hours: -5 } });
  check("noto'g'ri sozlama (manfiy) rad etildi", r.s === 400, r);

  out.push('1) Yangi akkaunt: shartlar bajarilmagan');
  const newbie = await mkUser('newbie', { days: 0, pin: false, gifts: 0 });
  const guar = await mkUser('guar', { balance: 5000 });
  r = await newbie.c.get('/api/credits/eligibility');
  const failKeys = r.d.checks.filter(c => !c.ok).map(c => c.key);
  check('akkaunt yoshi, faollik va PIN ❌', ['account_age', 'activity', 'has_pin'].every(k => failKeys.includes(k)), failKeys);
  check('all_ok = false', r.d.all_ok === false);
  check('faqat 1-tur ochiq (daraja 0)', r.d.types[0].unlocked === true && r.d.types[1].unlocked === false, r.d.types.map(t => t.unlocked));
  r = await newbie.c.post('/api/credits/take', body(t1, 200, guar), PIN);
  check("shartlar bajarilmasa so'rov rad etiladi (400)", r.s === 400 && r.d.check, r);

  out.push("2) Kredit so'rovi: shartlar oynasi, PIN, foiz");
  const bor = await mkUser('bor', { balance: 0 });
  r = await bor.c.get('/api/credits/eligibility');
  check('barcha shartlar ✅', r.d.all_ok === true, r.d.checks.filter(c => !c.ok));
  check("yangi qarzdor uchun foiz +3 (10 -> 13)", r.d.types.find(t => t.id === t1).interest_effective === 13, r.d.types.find(t => t.id === t1));
  r = await bor.c.post('/api/credits/take', { ...body(t1, 200, guar), terms_accepted: false }, PIN);
  check('shartlar tasdiqlanmasa 400', r.s === 400, r);
  r = await bor.c.post('/api/credits/take', { ...body(t1, 200, guar), confirm_amount: '150' }, PIN);
  check("summa noto'g'ri yozilsa 400", r.s === 400, r);
  r = await bor.c.post('/api/credits/take', body(t1, 200, guar));
  check('PIN yo\'q -> 403 pin_required', r.s === 403 && r.d.pin_required === true, r);
  r = await bor.c.post('/api/credits/take', body(t1, 200, guar), { 'X-Tx-Pin': '9999' });
  check("noto'g'ri PIN -> 403", r.s === 403 && r.d.pin_invalid === true, r);
  check("PIN xato bo'lsa so'rov yaratilmadi", (await q('SELECT COUNT(*) AS c FROM credit_requests WHERE user_id = ?', [bor.id]))[0].c === 0);
  r = await bor.c.post('/api/credits/take', body(t1, 200, guar), PIN);
  check("to'g'ri PIN: so'rov yaratildi", r.s === 200 && r.d.pending === true && r.d.interest_percent === 13, r);
  const req1 = r.d.request_id;
  r = await bor.c.post('/api/credits/take', body(t1, 200, guar), PIN);
  check("kutayotgan so'rov bor: ikkinchisi rad etiladi", r.s === 400, r);
  check("kredit hali berilmadi", (await bal(bor)) === 0);

  out.push('3) Kafil tasdiqlashi (PIN) -> qarzdor "Qabul qilaman"');
  r = await guar.c.get('/api/credits/requests/incoming');
  check('kafilga so\'rov keldi', r.d.length === 1 && r.d[0].id === req1, r);
  r = await guar.c.post(`/api/credits/requests/${req1}/respond`, { approve: true });
  check('kafil PINsiz tasdiqlay olmaydi', r.s === 403 && r.d.pin_required, r);
  r = await bor.c.post(`/api/credits/requests/${req1}/accept`, {}, PIN);
  check("kafil tasdiqlamaguncha qabul qilib bo'lmaydi", r.s === 400, r);
  r = await guar.c.post(`/api/credits/requests/${req1}/respond`, { approve: true }, PIN);
  check('kafil PIN bilan tasdiqladi -> qarzdor bosqichi', r.s === 200 && r.d.stage === 'borrower', r);
  check("kredit hali berilmadi (qarzdor qabul qilmagan)", (await bal(bor)) === 0);
  r = await bor.c.get('/api/credits/requests/mine');
  check("qarzdor ro'yxatida stage=borrower va muddat bor", r.d[0].stage === 'borrower' && !!r.d[0].stage_expires_at, r.d[0]);
  r = await bor.c.post(`/api/credits/requests/${req1}/accept`, {}, PIN);
  check('qarzdor qabul qildi -> kredit berildi', r.s === 200 && r.d.status === 'approved' && (await bal(bor)) === 200, r);
  const c1 = (await q('SELECT * FROM user_credits WHERE user_id = ?', [bor.id]))[0];
  check("foiz 13%: jami 226", c1 && c1.total_to_pay === 226 && c1.guarantor_id === guar.id, c1);
  r = await bor.c.post(`/api/credits/requests/${req1}/accept`, {}, PIN);
  check('qayta qabul qilib bo\'lmaydi (bitta kredit)', r.s === 400 && (await bal(bor)) === 200, r);

  out.push('4) Kredit coinini qulflash');
  const other = await mkUser('other', { balance: 0 });
  r = await bor.c.post('/api/transfers/coin', { to_username: other.name, amount: 10 }, PIN);
  check("kredit coini qulflangan: coin yuborib bo'lmaydi", r.s === 403 && r.d.credit_locked === true, r);
  const ugBor = (await q('SELECT id FROM user_gifts WHERE user_id = ? LIMIT 1', [bor.id]))[0].id;
  r = await bor.c.post('/api/transfers/gift', { to_username: other.name, inventory_id: ugBor }, PIN);
  check("gift yuborib bo'lmaydi", r.s === 403 && r.d.credit_locked === true, r);
  r = await bor.c.post('/api/trades/request', { username: other.name });
  check("trade so'rovi yuborib bo'lmaydi", r.s === 403 && r.d.credit_locked === true, r);
  r = await bor.c.get('/api/inventory/gifts');
  check("do'kon/inventar ishlaydi (qulf faqat jo'natishga)", r.s === 200);
  const lock = (await q('SELECT credit_lock_until FROM users WHERE id = ?', [bor.id]))[0].credit_lock_until;
  const hrs = (new Date(lock).getTime() - Date.now()) / 3600000;
  check('qulf ~48 soat', hrs > 47 && hrs <= 48.01, hrs);
  r = await bor.c.get('/api/credits/eligibility');
  check('faol kredit bor: shart ❌, 2-tur hali yopiq', r.d.checks.find(c => c.key === 'no_active').ok === false && r.d.types[1].unlocked === false);
  check('eligibility qulf vaqtini qaytaradi', !!r.d.credit_lock_until);

  out.push("5) To'lov, sovutish davri, daraja");
  r = await bor.c.post(`/api/credits/${c1.id}/pay`, { mode: 'early', amount: 99999 }, PIN);
  check("coin yetmaydi (200 < 226)", r.s === 400, r);
  await q('UPDATE users SET coin_balance = 1000, credit_lock_until = NULL WHERE id = ?', [bor.id]);
  r = await bor.c.post(`/api/credits/${c1.id}/pay`, { mode: 'early', amount: 99999 });
  check('kredit yopildi', r.s === 200 && r.d.status === 'paid', r);
  const c1b = (await q('SELECT closed_at, collateral_status FROM user_credits WHERE id = ?', [c1.id]))[0];
  check('closed_at yozildi', !!c1b.closed_at, c1b);
  r = await bor.c.get('/api/credits/eligibility');
  check('sovutish davri: yangi kredit olib bo\'lmaydi', r.d.checks.find(c => c.key === 'cooldown').ok === false, r.d.checks);
  check('daraja 1: 2-tur ochildi', r.d.rating.level === 1 && r.d.types[1].unlocked === true, r.d.rating);
  await q('UPDATE user_credits SET closed_at = ?', [DAYS(2)]);
  await ageRequests();
  r = await bor.c.get('/api/credits/eligibility');
  check('1 kundan keyin sovutish ✅', r.d.all_ok === true, r.d.checks.filter(c => !c.ok));
  check("o'z vaqtida yopgan: yangi qarzdor ustamasi yo'q (8%)", r.d.types[1].interest_effective === 8 && r.d.types[1].interest_with_collateral === 6, r.d.types[1]);

  out.push('6) Garov (gift)');
  await q('UPDATE users SET coin_balance = 5000 WHERE id = ?', [guar.id]);
  r = await bor.c.post('/api/credits/take', body(t2, 600, guar), PIN);
  check("500+ coinli kreditda garov majburiy", r.s === 400 && r.d.collateral_required === true, r);
  const ugCheap = (await q('SELECT id FROM user_gifts WHERE user_id = ? AND gift_id = ? LIMIT 1', [bor.id, cheap]))[0].id;
  r = await bor.c.post('/api/credits/take', body(t2, 600, guar, { collateral_user_gift_id: ugCheap }), PIN);
  check("arzon gift garov bo'la olmaydi", r.s === 400 && r.d.collateral_invalid === true, r);
  const ugPricey = (await q("INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, 700) RETURNING id", [bor.id, pricey]))[0].id;
  r = await bor.c.post('/api/credits/take', body(t2, 600, guar, { collateral_user_gift_id: ugPricey }), PIN);
  check("yetarli qimmat gift bilan so'rov yaratildi, foiz 8-2=6", r.s === 200 && r.d.interest_percent === 6, r);
  const req2 = r.d.request_id;
  check('garov gifti qulflandi (trade_id < 0)', (await q('SELECT trade_id FROM user_gifts WHERE id = ?', [ugPricey]))[0].trade_id === -req2);
  r = await bor.c.post(`/api/inventory/gifts/${ugPricey}/sell`, {}, PIN);
  check("garovdagi giftni sotib bo'lmaydi", r.s === 409, r);
  r = await bor.c.post('/api/transfers/gift', { to_username: other.name, inventory_id: ugPricey }, PIN);
  check("garovdagi giftni yuborib bo'lmaydi", r.s === 409, r);
  r = await bor.c.get('/api/trades/available-gifts');
  check("garovdagi gift trade uchun ko'rinmaydi", r.d.every(g => g.user_gift_id !== ugPricey), r.d);
  r = await bor.c.post(`/api/credits/requests/${req2}/cancel`, {});
  check('qarzdor bekor qildi', r.s === 200);
  check("bekor qilinganda garov bo'shadi", (await q('SELECT trade_id FROM user_gifts WHERE id = ?', [ugPricey]))[0].trade_id === null);

  out.push("7) Katta kredit: admin tasdig'i");
  await ageRequests();
  const ugHuge = (await q("INSERT INTO user_gifts (user_id, gift_id, bought_price) VALUES (?, ?, 1500) RETURNING id", [bor.id, huge]))[0].id;
  r = await bor.c.post('/api/credits/take', body(t2, 1200, guar, { collateral_user_gift_id: ugHuge }), PIN);
  check("1200 coinlik so'rov yaratildi", r.s === 200, r);
  const req3 = r.d.request_id;
  r = await guar.c.post(`/api/credits/requests/${req3}/respond`, { approve: true }, PIN);
  check("kafil tasdiqladi -> admin bosqichi", r.s === 200 && r.d.stage === 'admin', r);
  r = await bor.c.post(`/api/credits/requests/${req3}/accept`, {}, PIN);
  check("admin tasdiqlamaguncha qabul qilib bo'lmaydi", r.s === 400, r);
  r = await admin.get('/api/admin/credit-requests');
  check("admin ro'yxatida bor (garov nomi bilan)", r.d.some(x => x.id === req3 && x.collateral_name), r.d);
  r = await bor.c.post(`/api/admin/credit-requests/${req3}/respond`, { approve: true });
  check("oddiy foydalanuvchi admin tasdig'ini bera olmaydi", r.s === 403, r);
  r = await admin.post(`/api/admin/credit-requests/${req3}/respond`, { approve: true });
  check('admin tasdiqladi -> qarzdor bosqichi', r.s === 200 && r.d.stage === 'borrower', r);

  out.push('8) Qabul qilish muddati tugasa');
  await q("UPDATE credit_requests SET stage_expires_at = ? WHERE id = ?", [new Date(Date.now() - 60000).toISOString(), req3]);
  r = await bor.c.post(`/api/credits/requests/${req3}/accept`, {}, PIN);
  check("muddat tugadi: qabul qilib bo'lmaydi", r.s === 400, r);
  const st3 = (await q('SELECT status FROM credit_requests WHERE id = ?', [req3]))[0].status;
  check("so'rov avtomatik bekor qilindi", st3 === 'cancelled', st3);
  check("garov bo'shatildi", (await q('SELECT trade_id FROM user_gifts WHERE id = ?', [ugHuge]))[0].trade_id === null);
  check("kredit berilmadi", (await q("SELECT COUNT(*) AS c FROM user_credits WHERE user_id = ? AND status = 'active'", [bor.id]))[0].c === 0);

  out.push('9) Admin rad etsa');
  await ageRequests();
  r = await bor.c.post('/api/credits/take', body(t2, 1200, guar, { collateral_user_gift_id: ugHuge }), PIN);
  const req4 = r.d.request_id;
  await guar.c.post(`/api/credits/requests/${req4}/respond`, { approve: true }, PIN);
  r = await admin.post(`/api/admin/credit-requests/${req4}/respond`, { approve: false });
  check('admin rad etdi', r.s === 200 && r.d.status === 'rejected', r);
  check("garov bo'shatildi", (await q('SELECT trade_id FROM user_gifts WHERE id = ?', [ugHuge]))[0].trade_id === null);
  r = await bor.c.get('/api/credits/eligibility');
  check("rad etilgandan keyin pauza (1 soat)", r.d.checks.find(c => c.key === 'attempts').ok === false, r.d.checks);
  await ageRequests();

  out.push('10) Kunlik urinishlar limiti');
  await q("UPDATE credit_requests SET created_at = ?, responded_at = ?", [DAYS(0), DAYS(3)]);
  r = await bor.c.get('/api/credits/eligibility');
  check('limit tugagach (4 ta so\'rov) urinish ❌', r.d.attempts_left === 0 && r.d.checks.find(c => c.key === 'attempts').ok === false, r.d);
  await ageRequests();

  out.push('11) Kafil talablari');
  const youngG = await mkUser('youngg', { days: 2, balance: 5000 });
  const poorG = await mkUser('poorg', { balance: 10 });
  const noPinG = await mkUser('nopin', { balance: 5000, pin: false });
  const chk = async (g, amt = 200) => (await bor.c.get(`/api/credits/guarantor-check?username=${g.name}&amount=${amt}`)).d;
  check('yangi akkaunt kafil bo\'la olmaydi', (await chk(youngG)).checks.find(c => c.key === 'g_age').ok === false);
  check('coini yetmagan kafil rad etiladi', (await chk(poorG)).checks.find(c => c.key === 'g_balance').ok === false);
  check('PINsiz kafil rad etiladi', (await chk(noPinG)).checks.find(c => c.key === 'g_pin').ok === false);
  check("yaxshi kafil: hammasi ✅", (await chk(guar)).ok === true, await chk(guar));
  await q("INSERT INTO credit_requests (user_id, guarantor_id, credit_type_id, amount) VALUES (?, ?, ?, 100), (?, ?, ?, 100)", [other.id, guar.id, t1, other.id, guar.id, t1]);
  check("kafil 2 ta kreditga kafil bo'lsa, 3-sini olmaydi", (await chk(guar)).checks.find(c => c.key === 'g_load').ok === false);
  await q("DELETE FROM credit_requests WHERE user_id = ?", [other.id]);
  check("o'zini kafil qila olmaydi", (await bor.c.get(`/api/credits/guarantor-check?username=${bor.name}`)).d.ok === false);
  // Bir IP
  await admin.put('/api/admin/credit-settings', { settings: { credit_block_same_ip: 1 } });
  await q("INSERT INTO login_history (user_id, ip, device, success) VALUES (?, '10.1.1.1', 'x', 1), (?, '10.1.1.1', 'x', 1)", [bor.id, guar.id]);
  check("bir IP dan kirgan kafil rad etiladi", (await chk(guar)).checks.find(c => c.key === 'g_ip').ok === false);
  await q("DELETE FROM login_history WHERE ip = '10.1.1.1'");
  await q("DELETE FROM login_history WHERE user_id IN (?, ?)", [bor.id, guar.id]);
  await q("INSERT INTO login_history (user_id, ip, device, success) VALUES (?, '10.2.2.2', 'x', 1), (?, '10.3.3.3', 'x', 1)", [bor.id, guar.id]);
  check("turli IP: ruxsat", (await chk(guar)).checks.find(c => c.key === 'g_ip').ok === true);
  await admin.put('/api/admin/credit-settings', { settings: { credit_block_same_ip: 0 } });

  out.push("12) To'lanmasa garov saytga o'tadi");
  const borrower2 = await mkUser('bor2', { balance: 0 });
  await q("INSERT INTO user_credits (user_id, credit_type_id, principal_amount, total_to_pay, remaining_amount, weekly_payment, next_payment_at, guarantor_id, collateral_user_gift_id, collateral_status) VALUES (?, ?, 600, 650, 650, 160, ?, ?, ?, 'locked')",
    [borrower2.id, t2, DAYS(30), guar.id, 0]);
  const ugB2 = (await q("INSERT INTO user_gifts (user_id, gift_id, bought_price, trade_id) VALUES (?, ?, 700, -9999) RETURNING id", [borrower2.id, pricey]))[0].id;
  await q("UPDATE user_credits SET collateral_user_gift_id = ? WHERE user_id = ?", [ugB2, borrower2.id]);
  await q("INSERT INTO profile_pins (user_id, user_gift_id) VALUES (?, ?)", [borrower2.id, ugB2]);
  await borrower2.c.get('/api/credits/my');
  const cB2 = (await q('SELECT status, collateral_status, closed_at FROM user_credits WHERE user_id = ?', [borrower2.id]))[0];
  check("kredit defaulted, garov 'forfeited'", cB2.status === 'defaulted' && cB2.collateral_status === 'forfeited' && !!cB2.closed_at, cB2);
  check("garov gifti qarzdor inventaridan o'chdi", (await q('SELECT COUNT(*) AS c FROM user_gifts WHERE id = ?', [ugB2]))[0].c === 0);
  check("profilga qadalgan nusxa ham o'chdi", (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_gift_id = ?', [ugB2]))[0].c === 0);

  out.push("13) Kredit yopilganda garov qaytadi");
  const borrower3 = await mkUser('bor3', { balance: 5000 });
  const ugB3 = (await q("INSERT INTO user_gifts (user_id, gift_id, bought_price, trade_id) VALUES (?, ?, 700, -8888) RETURNING id", [borrower3.id, pricey]))[0].id;
  const cid = (await q("INSERT INTO user_credits (user_id, credit_type_id, principal_amount, total_to_pay, remaining_amount, weekly_payment, next_payment_at, guarantor_id, collateral_user_gift_id, collateral_status) VALUES (?, ?, 600, 650, 650, 160, ?, ?, ?, 'locked') RETURNING id",
    [borrower3.id, t2, new Date(Date.now() + 86400000).toISOString(), guar.id, ugB3]))[0].id;
  r = await borrower3.c.post(`/api/credits/${cid}/pay`, { mode: 'early', amount: 650 });
  check("to'liq to'landi", r.s === 200 && r.d.status === 'paid', r);
  check("garov gifti qaytarildi", (await q('SELECT trade_id FROM user_gifts WHERE id = ?', [ugB3]))[0].trade_id === null);
  check("collateral_status = released", (await q('SELECT collateral_status FROM user_credits WHERE id = ?', [cid]))[0].collateral_status === 'released');

  out.push('14) Admin sozlamalari');
  r = await admin.get('/api/admin/credit-settings');
  check("20 ta sozlama ro'yxati", r.s === 200 && r.d.length >= 20, r.d && r.d.length);
  r = await bor.c.get('/api/admin/credit-settings');
  check("oddiy foydalanuvchiga yopiq", r.s === 403);
  r = await admin.put('/api/admin/credit-settings', { settings: { credit_min_account_days: 40 } });
  check("sozlama o'zgardi", r.d.find(x => x.key === 'credit_min_account_days').value === 40);
  r = await bor.c.get('/api/credits/eligibility');
  check("yangi qoida darrov ishladi (akkaunt 30 kunlik < 40)", r.d.checks.find(c => c.key === 'account_age').ok === false);
  await admin.put('/api/admin/credit-settings', { settings: { credit_min_account_days: 7 } });

  out.push('15) Preview');
  r = await bor.c.post('/api/credits/preview', { credit_type_id: t2, amount: 600, collateral_user_gift_id: ugPricey });
  check("preview: foiz 6%, jami 636, haftalik 159, jarima 12% = 72", r.s === 200 && r.d.interest_percent === 6 && r.d.total_to_pay === 636 && r.d.weekly_payment === 159 && r.d.fine_amount === 72, r.d);
  check("preview: kafil jarimasi haftalikning 50%", r.d.guarantor_penalty_amount === 79.5, r.d);

  console.log(out.join('\n'));
  console.log(`\nNatija: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST XATOSI:', e); process.exit(2); });


