// MTshop Gift Trade — xavfsizlik va to'g'rilik testlari (haqiqiy HTTP server + mahalliy SQLite fayl).
// OGOHLANTIRISH: faqat bo'sh TEST bazasida ishlating (u foydalanuvchilar, gift va coinlar yaratadi).
//
//   cd backend
//   export TURSO_DATABASE_URL=file:/tmp/trade-test.db JWT_SECRET=test PORT=4222
//   node src/seed-admin.js admin admin123
//   node src/server.js &
//   TRADE_TEST_URL=http://localhost:4222 TRADE_TEST_DB=file:/tmp/trade-test.db node tests/trade.test.js
//
// Oxirgi test bloklangan foydalanuvchi trade'ini scheduler bekor qilishini kutadi (~31 soniya).
// MTshop Trade tizimi — xavfsizlik va to'g'rilik testlari (haqiqiy HTTP server + mahalliy SQLite)
// MTshop Trade tizimi — xavfsizlik va to'g'rilik testlari (haqiqiy HTTP server + mahalliy SQLite)
const { createClient } = require('@libsql/client');
const B = process.env.TRADE_TEST_URL || 'http://localhost:4222';
const raw = createClient({ url: process.env.TRADE_TEST_DB || 'file:/tmp/trade-test.db' });
const q = async (sql, args = []) => { const r = await raw.execute({ sql, args }); return r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))); };

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass++; results.push('  ✅ ' + name); }
  else { fail++; results.push('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async call(method, path, body) {
    const r = await fetch(B + path, {
      method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch (e) {}
    return { s: r.status, d: data };
  }
  get(p) { return this.call('GET', p); }
  post(p, b) { return this.call('POST', p, b || {}); }
  put(p, b) { return this.call('PUT', p, b || {}); }
  del(p) { return this.call('DELETE', p); }
  async login(u, p) { const r = await this.post('/api/auth/login', { username: u, password: p }); if (r.s !== 200) throw new Error('login ' + u + ' ' + r.s); return r.d; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = {};
const balance = async n => (await q('SELECT coin_balance AS c FROM users WHERE id=?', [uid[n]]))[0].c;
const clearCooldown = async (...names) => { for (const n of names) await q('UPDATE users SET last_trade_request_at=NULL WHERE id=?', [uid[n]]); };
const giftsOf = async n => (await q('SELECT id, gift_id, trade_id FROM user_gifts WHERE user_id=? ORDER BY id', [uid[n]]));
const activeRows = async () => q('SELECT * FROM trade_active_users');
const tradeRow = async id => (await q('SELECT * FROM trades WHERE id=?', [id]))[0];

(async () => {
  const admin = new Client('admin');
  await admin.login('admin', 'admin123');
  const names = ['ali', 'sardor', 'zarina', 'hasan'];
  const C = {};
  for (const n of names) {
    const r = await admin.post('/api/admin/users', { username: n, password: n + '123' });
    uid[n] = r.d.id;
    await admin.post(`/api/admin/users/${r.d.id}/coin`, { amount: 100000, action: 'give' });
    C[n] = new Client(n); await C[n].login(n, n + '123');
  }
  // giftlar
  const gCat = (await admin.post('/api/admin/gifts', { name: 'Golden Cat', price: 100, unlimited: true })).d;
  const gDog = (await admin.post('/api/admin/gifts', { name: 'Lunar Dog', price: 50, unlimited: true })).d;
  for (let i = 0; i < 7; i++) await C.ali.post(`/api/gifts/${gCat.id}/buy`, { quantity: 1 });
  for (let i = 0; i < 3; i++) await C.sardor.post(`/api/gifts/${gDog.id}/buy`, { quantity: 1 });
  await C.zarina.post(`/api/gifts/${gDog.id}/buy`, { quantity: 1 });
  const ali0 = await giftsOf('ali'); const sar0 = await giftsOf('sardor');
  check('Setup: Ali 7 ta, Sardor 3 ta gift', ali0.length === 7 && sar0.length === 3);

  // helper: ACTIVE trade yaratish
  async function startTrade(a, b) {
    await clearCooldown(a, b);
    const r = await C[a].post('/api/trades/request', { username: b });
    if (r.s !== 200) throw new Error('request ' + JSON.stringify(r));
    const acc = await C[b].post(`/api/trades/${r.d.id}/accept`);
    if (acc.s !== 200) throw new Error('accept ' + JSON.stringify(acc));
    return r.d.id;
  }
  async function cleanup(id, who = 'ali') { await C[who].post(`/api/trades/${id}/cancel`); }

  // ============ Test 1: expired request ============
  results.push('Test 1 — Request 5 daqiqadan keyin (EXPIRED) Accept qilinmasin');
  {
    const r = await C.ali.post('/api/trades/request', { username: 'sardor' });
    check('Request yaratildi (PENDING, 5 daqiqa)', r.s === 200 && r.d.status === 'PENDING');
    const t = await tradeRow(r.d.id);
    const ttl = new Date(t.expires_at) - new Date(t.created_at);
    check('expires_at = created_at + 5 daqiqa (server vaqti)', ttl === 5 * 60 * 1000, ttl);
    const sum = await C.sardor.get('/api/trades/summary');
    check('Sardor offline bo\'lib keyin kirganda request ko\'rinadi', sum.d.incoming.length === 1 && sum.d.incoming[0].from_username === 'ali');
    await q('UPDATE trades SET expires_at=? WHERE id=?', [new Date(Date.now() - 1000).toISOString(), r.d.id]);
    const acc = await C.sardor.post(`/api/trades/${r.d.id}/accept`);
    check('Muddati o\'tgan request Accept qilinmadi', acc.s === 410 || acc.s === 409, acc);
    check('Status EXPIRED bo\'ldi', (await tradeRow(r.d.id)).status === 'EXPIRED');
    const acc2 = await C.sardor.post(`/api/trades/${r.d.id}/accept`);
    check('EXPIRED -> ACTIVE mumkin emas (qayta urinish)', acc2.s === 409);
    const sum2 = await C.ali.get('/api/trades/summary');
    check('Ali\'ga "muddati tugadi" bildirishnomasi', sum2.d.notifications.some(n => n.type === 'expired'));
  }

  // ============ Test 2: cooldown ============
  results.push('Test 2 — 20 daqiqalik cooldown');
  {
    // Ali Test 1 da request yuborgan edi (cooldown davom etmoqda)
    const r = await C.ali.post('/api/trades/request', { username: 'zarina' });
    check('Ali 20 daqiqada ikkinchi request yubora olmadi (429)', r.s === 429 && r.d.code === 'COOLDOWN', r);
    const r2 = await C.ali.post('/api/trades/request', { username: 'hasan' });
    check('Boshqa foydalanuvchiga ham mumkin emas', r2.s === 429);
    // client "vaqt" yuborsa ham ishonilmaydi
    const r3 = await C.ali.post('/api/trades/request', { username: 'zarina', lastTradeRequestAt: 0, now: Date.now() + 3600000 });
    check('Client yuborgan vaqtga ishonilmadi', r3.s === 429);
    await q('UPDATE users SET last_trade_request_at=? WHERE id=?', [new Date(Date.now() - 21 * 60 * 1000).toISOString(), uid.ali]);
    const r4 = await C.ali.post('/api/trades/request', { username: 'zarina' });
    check('21 daqiqadan keyin yangi request mumkin', r4.s === 200, r4);
    // parallel: cooldown atomik bo'lishi kerak
    await C.ali.post(`/api/trades/${r4.d.id}/cancel`);
    await clearCooldown('ali');
    const par = await Promise.all([1, 2, 3, 4].map(() => C.ali.post('/api/trades/request', { username: 'hasan' })));
    check('Parallel 4 ta request -> faqat bittasi o\'tdi', par.filter(x => x.s === 200).length === 1, par.map(x => x.s));
    const pid = par.find(x => x.s === 200).d.id;
    await C.ali.post(`/api/trades/${pid}/cancel`);
    // DB darajasida: ikkinchi PENDING bo'lishi mumkin emas
    await clearCooldown('ali');
    const a = await C.ali.post('/api/trades/request', { username: 'hasan' });
    await clearCooldown('ali');
    const b = await C.ali.post('/api/trades/request', { username: 'zarina' });
    check('Pending request bor ekan, ikkinchisi rad etildi', b.s === 409 && b.d.code === 'PENDING_EXISTS', b);
    let dbBlocked = false;
    try { await q("INSERT INTO trades (user_a_id,user_b_id,status,expires_at,created_at) VALUES (?,?, 'PENDING','2999-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')", [uid.ali, uid.zarina]); } catch (e) { dbBlocked = /UNIQUE/i.test(e.message); }
    check('Baza darajasida: bitta yuboruvchida 2 ta PENDING yaratib bo\'lmaydi (UNIQUE index)', dbBlocked);
    await C.ali.post(`/api/trades/${a.d.id}/cancel`);
    const self = await C.ali.post('/api/trades/request', { username: 'ali' });
    check('O\'zi bilan trade rad etildi', self.s === 400 || self.s === 429);
  }

  // ============ Test 3: ACTIVE trade ichida yangi request ============
  results.push('Test 3 — ACTIVE trade bo\'lsa yangi request mumkin emas');
  let t1;
  {
    t1 = await startTrade('ali', 'sardor');
    check('Ali ↔ Sardor ACTIVE', (await tradeRow(t1)).status === 'ACTIVE');
    await clearCooldown('ali', 'zarina');
    const r = await C.ali.post('/api/trades/request', { username: 'zarina' });
    check('Ali (ACTIVE) Zarina\'ga request yubora olmadi', r.s === 409 && r.d.code === 'ACTIVE_TRADE', r);
    const r2 = await C.zarina.post('/api/trades/request', { username: 'ali' });
    check('Zarina ACTIVE trade ichidagi Ali\'ga request yubora olmadi', r2.s === 409 && r2.d.code === 'TARGET_BUSY', r2);
    check('trade_active_users: aynan 2 qator', (await activeRows()).length === 2);
    let pkBlocked = false;
    try { await q('INSERT INTO trade_active_users (user_id, trade_id) VALUES (?, ?)', [uid.ali, 9999]); } catch (e) { pkBlocked = /UNIQUE|PRIMARY/i.test(e.message); }
    check('Baza darajasida: Ali uchun ikkinchi ACTIVE yozuv qo\'shib bo\'lmaydi (PRIMARY KEY)', pkBlocked);
  }

  // ============ Test 9 (erta): chat xavfsizligi ============
  results.push('Test 9 — Chat xavfsizligi');
  {
    const m1 = await C.ali.post(`/api/trades/${t1}/messages`, { text: 'Salom <script>alert(1)</script> <img src=x onerror=alert(1)>' });
    check('Xabar yuborildi', m1.s === 200);
    const v = await C.sardor.get(`/api/trades/${t1}`);
    check('Sardor xabarni ko\'radi (matn JSON ichida xom saqlanadi, client esc() bilan chiqaradi)', v.d.messages.length === 1 && v.d.messages[0].body.includes('<script>'));
    const big = await C.ali.post(`/api/trades/${t1}/messages`, { text: 'x'.repeat(501) });
    check('501 belgi rad etildi', big.s === 400);
    const ok500 = await C.ali.post(`/api/trades/${t1}/messages`, { text: 'y'.repeat(500) });
    check('500 belgi qabul qilindi', ok500.s === 200);
    const empty = await C.ali.post(`/api/trades/${t1}/messages`, { text: '   ' });
    check('Bo\'sh xabar rad etildi', empty.s === 400);
    const spy = await C.zarina.get(`/api/trades/${t1}`);
    check('Zarina Trade ID orqali o\'qiy olmaydi (403)', spy.s === 403, spy);
    const spy2 = await C.zarina.post(`/api/trades/${t1}/messages`, { text: 'hack' });
    check('Zarina yoza olmaydi (403)', spy2.s === 403);
    const spy3 = await C.zarina.put(`/api/trades/${t1}/offer/coin`, { amount: 5 });
    check('Zarina offerni o\'zgartira olmaydi', spy3.s === 403);
    const spy4 = await C.zarina.post(`/api/trades/${t1}/cancel`);
    check('Zarina bekor qila olmaydi', spy4.s === 403);
    const weird = await C.ali.get('/api/trades/abc');
    const weird2 = await C.ali.get('/api/trades/1%20OR%201=1');
    check('Noto\'g\'ri ID (SQL injection urinishi) 404', weird.s === 404 && weird2.s === 404);
    const am = await admin.get(`/api/admin/trades/${t1}/chat`);
    check('Admin chatni ochdi', am.s === 200 && am.d.length >= 2);
    const lg = await q("SELECT * FROM trade_logs WHERE trade_id=? AND action='admin_chat_viewed'", [t1]);
    check('Admin chat ochishi audit logga yozildi', lg.length === 1 && lg[0].user_id === uid.admin || lg.length === 1);
    const non = await C.ali.get(`/api/admin/trades/${t1}/chat`);
    check('Oddiy user admin endpointiga kira olmaydi', non.s === 403);
  }

  // ============ Offer qoidalari + Test 10 (tamper) ============
  results.push('Test 10 — Client ma\'lumotlariga ishonmaslik + offer qoidalari');
  {
    const aliG = await giftsOf('ali'); const sarG = await giftsOf('sardor');
    const x1 = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: sarG[0].id });
    check('Boshqa user giftini offerga qo\'shib bo\'lmaydi', x1.s === 404, x1);
    const x2 = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: 999999 });
    check('Mavjud bo\'lmagan gift ID rad etildi', x2.s === 404);
    const x3 = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: 'abc' });
    check('Noto\'g\'ri gift ID formati rad etildi', x3.s === 400);
    for (const bad of [-5, 1.5, 'abc', null, '1e3', 100001, {}]) {
      const r = await C.ali.put(`/api/trades/${t1}/offer/coin`, { amount: bad });
      if (r.s !== 400) check('Noto\'g\'ri coin ' + JSON.stringify(bad) + ' rad etilishi kerak', false, r);
    }
    check('Manfiy / kasr / matn / 100000+ coin rad etildi', true);
    // 5 ta gift
    for (let i = 0; i < 5; i++) {
      const r = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: aliG[i].id });
      if (r.s !== 200) check('Gift ' + (i + 1) + ' qo\'shildi', false, r);
    }
    const six = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: aliG[5].id });
    check('6-gift rad etildi (max 5)', six.s === 400, six);
    const dup = await C.ali.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: aliG[0].id });
    check('Bir xil giftni ikki marta qo\'shib bo\'lmaydi', dup.s === 409 || dup.s === 400, dup);
    await admin.post(`/api/admin/users/${uid.ali}/coin`, { amount: 50000, action: 'give' });
    const bal0 = await balance('ali');
    const c1 = await C.ali.put(`/api/trades/${t1}/offer/coin`, { amount: 100000 });
    check('100000 coin qo\'yildi (limit)', c1.s === 200, c1);
    check('Coin escrow: balansdan yechildi', (await balance('ali')) === bal0 - 100000, await balance('ali'));
    const c2 = await C.ali.put(`/api/trades/${t1}/offer/coin`, { amount: 100 });
    check('Coin kamaytirildi -> farq qaytdi', c2.s === 200 && (await balance('ali')) === bal0 - 100);
    const sarBal = await balance('sardor');
    const c3 = await C.sardor.put(`/api/trades/${t1}/offer/coin`, { amount: sarBal + 1 });
    check('Balansdan ortiq coin rad etildi (server DB bilan tekshiradi)', c3.s === 400, c3);
    // Trade'dagi giftni boshqa yo'llar bilan ishlatish (Test 8: lock/reserve)
    const sell = await C.ali.post(`/api/inventory/gifts/${aliG[0].id}/sell`);
    check('Test 8: Trade\'dagi giftni sotib bo\'lmaydi', sell.s === 409, sell);
    const send = await C.ali.post('/api/transfers/gift', { to_username: 'zarina', inventory_id: aliG[1].id });
    check('Test 8: Trade\'dagi giftni yuborib bo\'lmaydi', send.s === 409, send);
    const g6 = await C.ali.post(`/api/inventory/gifts/${aliG[5].id}/sell`);
    check('Trade\'ga qo\'shilmagan gift odatdagidek sotiladi', g6.s === 200, g6);
    // Coin sarflash: coin escrow'da, shuning uchun balansdan tashqari
    // Balansdan 20 coin ko'p (lekin balans + escrow(100) dan kam) yuborishga urinish: escrow ishlatilmasligi kerak
    const balNow = await balance('ali');
    const tryAmt = Math.floor(balNow / 1.03) + 20;
    const bigSend = await C.ali.post('/api/transfers/coin', { to_username: 'zarina', amount: tryAmt });
    check('Test 8: Escrow\'dagi coinni boshqaga yuborib bo\'lmaydi', bigSend.s === 400, [balNow, tryAmt, bigSend]);
    check('  ... balans o\'zgarmadi', (await balance('ali')) === balNow);
    // Sardor offeri
    await C.sardor.post(`/api/trades/${t1}/offer/gift`, { user_gift_id: sarG[0].id });
    await C.sardor.put(`/api/trades/${t1}/offer/coin`, { amount: 50 });
    // lock tartibi
    const view = await C.ali.get(`/api/trades/${t1}`);
    check('Ali o\'z offerini ko\'radi (5 gift + 100 coin)', view.d.my.gifts.length === 5 && view.d.my.coin === 100);
    check('Ali Sardor offerini ko\'radi (1 gift + 50 coin)', view.d.their.gifts.length === 1 && view.d.their.coin === 50);
    const early = await C.ali.post(`/api/trades/${t1}/confirm`);
    check('Lock qilmasdan Confirm mumkin emas', early.s === 409 && early.d.code === 'NOT_LOCKED', early);
    await C.ali.post(`/api/trades/${t1}/lock`);
    const edit = await C.ali.put(`/api/trades/${t1}/offer/coin`, { amount: 1 });
    check('Lock qilingan offerni o\'zgartirib bo\'lmaydi', edit.s === 409 && edit.d.code === 'LOCKED', edit);
    const rm = await C.ali.del(`/api/trades/${t1}/offer/gift/${aliG[0].id}`);
    check('Lock qilingan offerdan gift olib tashlab bo\'lmaydi', rm.s === 409);
    await C.sardor.post(`/api/trades/${t1}/lock`);
    let cf = await C.ali.get(`/api/trades/${t1}`);
    check('Ikkala tomon LOCKED -> Confirm aktiv', cf.d.can.confirm === true && cf.d.their.locked === true);
    await C.ali.post(`/api/trades/${t1}/confirm`);
    cf = await C.sardor.get(`/api/trades/${t1}`);
    check('Ali confirm qildi, hali COMPLETED emas', cf.d.trade.status === 'ACTIVE' && cf.d.their.confirmed === true);
    // Unlock & Edit -> ikkala lock reset
    await C.ali.post(`/api/trades/${t1}/unlock`);
    let st = await tradeRow(t1);
    check('Unlock: Ali tasdig\'i bekor bo\'ldi', st.a_confirmed === 0 && st.a_locked === 0);
    await C.ali.put(`/api/trades/${t1}/offer/coin`, { amount: 120 });
    st = await tradeRow(t1);
    check('Offer o\'zgarganda ikkala tomon lock\'i reset (Sardor ham UNLOCKED)', st.a_locked === 0 && st.b_locked === 0 && st.b_confirmed === 0, st);
    const sn = await C.sardor.get('/api/trades/summary');
    check('Sardor\'ga "offer o\'zgardi" bildirishnomasi', sn.d.notifications.some(n => n.type === 'offer_changed'));
    // Cancel -> hamma qaytadi
    const balBefore = { ali: await balance('ali'), sardor: await balance('sardor') };
    const cc = await C.ali.post(`/api/trades/${t1}/cancel`);
    check('Cancel: ACTIVE -> CANCELLED', cc.s === 200 && (await tradeRow(t1)).status === 'CANCELLED');
    check('Cancel: coinlar qaytdi (Ali +120, Sardor +50)', (await balance('ali')) === balBefore.ali + 120 && (await balance('sardor')) === balBefore.sardor + 50);
    const ng = await q('SELECT COUNT(*) AS c FROM user_gifts WHERE trade_id IS NOT NULL');
    check('Cancel: giftlar band holatdan chiqdi', ng[0].c === 0);
    check('Cancel: trade_active_users tozalandi', (await activeRows()).length === 0);
    const post = await C.ali.post(`/api/trades/${t1}/messages`, { text: 'hali?' });
    check('Bekor qilingan trade chatiga yozib bo\'lmaydi', post.s === 409 && post.d.code === 'CHAT_CLOSED', post);
    const reopen = await C.sardor.post(`/api/trades/${t1}/accept`);
    check('CANCELLED -> ACTIVE mumkin emas', reopen.s === 409 || reopen.s === 403);
  }

  // ============ Test 6, 7: Confirm — yakunlash, bir vaqtda, retry ============
  results.push('Test 6/7 — Atomik yakunlash va idempotentlik');
  let t2;
  {
    t2 = await startTrade('ali', 'sardor');
    const aliG = await giftsOf('ali'); const sarG = await giftsOf('sardor');
    const aliOffer = [aliG[0].id, aliG[1].id]; const sarOffer = [sarG[0].id];
    for (const id of aliOffer) await C.ali.post(`/api/trades/${t2}/offer/gift`, { user_gift_id: id });
    await C.sardor.post(`/api/trades/${t2}/offer/gift`, { user_gift_id: sarOffer[0] });
    await C.ali.put(`/api/trades/${t2}/offer/coin`, { amount: 100 });
    await C.sardor.put(`/api/trades/${t2}/offer/coin`, { amount: 50 });
    await C.ali.post(`/api/trades/${t2}/lock`); await C.sardor.post(`/api/trades/${t2}/lock`);
    const before = { ali: await balance('ali'), sardor: await balance('sardor'), total: (await q('SELECT SUM(coin_balance) AS s FROM users'))[0].s };
    const nGiftsBefore = (await q('SELECT COUNT(*) AS c FROM user_gifts'))[0].c;
    // ikkalasi + takroriy so'rovlar bir vaqtda
    const par = await Promise.all([
      C.ali.post(`/api/trades/${t2}/confirm`), C.sardor.post(`/api/trades/${t2}/confirm`),
      C.ali.post(`/api/trades/${t2}/confirm`), C.sardor.post(`/api/trades/${t2}/confirm`),
      C.ali.post(`/api/trades/${t2}/confirm`), C.sardor.post(`/api/trades/${t2}/confirm`),
    ]);
    check('Hamma confirm so\'rovlari xatosiz javob berdi', par.every(r => r.s === 200), par.map(r => r.s));
    const tr = await tradeRow(t2);
    check('Trade faqat bir marta COMPLETED', tr.status === 'COMPLETED' && tr.escrow === 'settled');
    const after = { ali: await balance('ali'), sardor: await balance('sardor') };
    check('Coin: Ali -100 +50 (escrow allaqachon yechilgan: balans = oldingi + 50)', after.ali === before.ali + 50, [before.ali, after.ali]);
    check('Coin: Sardor -50 +100 (balans = oldingi + 100)', after.sardor === before.sardor + 100, [before.sardor, after.sardor]);
    const total = (await q('SELECT SUM(coin_balance) AS s FROM users'))[0].s;
    check('Coin yo\'qolmadi va ikki marta berilmadi (umumiy summa = oldingi + escrow qaytishi)', total === before.total + 150, [before.total, total]);
    const aliNow = (await giftsOf('ali')).map(g => g.id); const sarNow = (await giftsOf('sardor')).map(g => g.id);
    check('Giftlar almashdi: Ali\'dan 2 ta ketdi, Sardor giftini oldi', aliOffer.every(id => !aliNow.includes(id)) && aliNow.includes(sarOffer[0]));
    check('Sardor Ali\'ning 2 ta giftini oldi', aliOffer.every(id => sarNow.includes(id)) && !sarNow.includes(sarOffer[0]));
    check('Giftlar soni o\'zgarmadi (yo\'qolmadi, ko\'paymadi)', (await q('SELECT COUNT(*) AS c FROM user_gifts'))[0].c === nGiftsBefore);
    check('Band holat tozalandi', (await q('SELECT COUNT(*) AS c FROM user_gifts WHERE trade_id IS NOT NULL'))[0].c === 0);
    const hist = await q('SELECT * FROM transfers WHERE trade_id=?', [t2]);
    check('Mavjud transfer tarixiga yozildi (3 gift + 2 coin = 5 qator)', hist.length === 5, hist.length);
    check('Transfer tarixi: seen=1 (qo\'shimcha "sovg\'a keldi" oynasi chiqmaydi)', hist.every(h => h.seen === 1));
    check('trade_active_users bo\'shadi', (await activeRows()).length === 0);
    const logs = await q("SELECT action, COUNT(*) AS c FROM trade_logs WHERE trade_id=? GROUP BY action", [t2]);
    const cnt = Object.fromEntries(logs.map(l => [l.action, l.c]));
    check('Audit: trade_completed bir marta, trade_confirmed ikki marta', cnt.trade_completed === 1 && cnt.trade_confirmed === 2, cnt);
    const again = await C.ali.post(`/api/trades/${t2}/confirm`);
    check('Test 7: yakunlangandan keyin retry -> ikkinchi almashuv bo\'lmaydi', again.s === 200 && again.d.already === true);
    check('  ... va balans o\'zgarmadi', (await balance('ali')) === after.ali);
    const cx = await C.ali.post(`/api/trades/${t2}/cancel`);
    check('COMPLETED trade bekor qilinmaydi', cx.s === 409 && cx.d.code === 'COMPLETED');
    const ed = await C.ali.put(`/api/trades/${t2}/offer/coin`, { amount: 5 });
    check('COMPLETED trade offerini o\'zgartirib bo\'lmaydi', ed.s === 409);
    const hv = await C.ali.get('/api/trades/history');
    check('Foydalanuvchi o\'z trade tarixini ko\'radi', hv.s === 200 && hv.d.some(x => x.id === t2 && x.status === 'COMPLETED' && x.with === 'sardor'));
  }

  // ============ Test 4/5: ikki PENDING (eski holat) ============
  results.push('Test 4/5 — Ali → Sardor va Ali → Zarina (eski holat), Accept poygasi');
  {
    await q('DROP INDEX IF EXISTS uq_trades_one_pending_per_sender');   // eski/noto'g'ri holatni simulyatsiya qilish
    const mk = async (to) => { const now = new Date(); return (await raw.execute({ sql: "INSERT INTO trades (user_a_id,user_b_id,status,expires_at,created_at) VALUES (?,?, 'PENDING',?,?)", args: [uid.ali, uid[to], new Date(now.getTime() + 300000).toISOString(), now.toISOString()] })).lastInsertRowid; };
    // 4-test: ketma-ket
    const ta = Number(await mk('sardor')); const tb = Number(await mk('zarina'));
    const r1 = await C.sardor.post(`/api/trades/${ta}/accept`);
    const r2 = await C.zarina.post(`/api/trades/${tb}/accept`);
    check('Test 4: Sardor Accept -> ACTIVE', r1.s === 200 && (await tradeRow(ta)).status === 'ACTIVE', r1);
    check('Test 4: Ali → Zarina avtomatik CANCELLED', (await tradeRow(tb)).status === 'CANCELLED');
    check('Test 4: Zarina Accept -> "Bu Trade Request endi faol emas."', r2.s === 409 && /endi faol emas/.test(r2.d.error), r2);
    check('Test 4: Ali faqat bitta ACTIVE trade ichida', (await q('SELECT COUNT(*) AS c FROM trade_active_users WHERE user_id=?', [uid.ali]))[0].c === 1);
    // sender_busy yo'li: Zarina requesti hali PENDING qolgan, lekin Ali band
    const tc = Number(await mk('zarina'));
    const r3 = await C.zarina.post(`/api/trades/${tc}/accept`);
    check('Ali band bo\'lsa, PENDING requestni Accept qilish REJECTED + xabar', r3.s === 409 && /boshqa Trade/.test(r3.d.error) && (await tradeRow(tc)).status === 'REJECTED', r3);
    await cleanup(ta);
    // 5-test: bir vaqtda Accept
    const tp = Number(await mk('sardor')); const tq = Number(await mk('zarina'));
    const race = await Promise.all([C.sardor.post(`/api/trades/${tp}/accept`), C.zarina.post(`/api/trades/${tq}/accept`)]);
    const okCount = race.filter(r => r.s === 200).length;
    check('Test 5: bir vaqtda Accept -> faqat bittasi ACTIVE', okCount === 1, race.map(r => r.s));
    const act = await q("SELECT id FROM trades WHERE status='ACTIVE'");
    check('Test 5: bazada aynan 1 ta ACTIVE trade', act.length === 1, act);
    check('Test 5: Ali uchun 1 ta active qator', (await q('SELECT COUNT(*) AS c FROM trade_active_users WHERE user_id=?', [uid.ali]))[0].c === 1);
    const loser = race.find(r => r.s !== 200);
    check('Test 5: ikkinchisiga aniq xabar qaytdi', loser && loser.s === 409 && loser.d.error, loser);
    await cleanup(act[0].id);
    await q("DELETE FROM trades WHERE status='PENDING'");
    // 3 ta requestni parallel (Hasan ham)
    const t3 = [Number(await mk('sardor')), Number(await mk('zarina')), Number(await mk('hasan'))];
    const race3 = await Promise.all([C.sardor.post(`/api/trades/${t3[0]}/accept`), C.zarina.post(`/api/trades/${t3[1]}/accept`), C.hasan.post(`/api/trades/${t3[2]}/accept`)]);
    check('3 ta parallel Accept -> faqat bittasi ACTIVE', race3.filter(r => r.s === 200).length === 1, race3.map(r => r.s));
    check('  ... Ali hali ham 1 ta active ichida', (await q('SELECT COUNT(*) AS c FROM trade_active_users WHERE user_id=?', [uid.ali]))[0].c === 1);
    const act3 = await q("SELECT id FROM trades WHERE status='ACTIVE'");
    await cleanup(act3[0].id);
    await q("DELETE FROM trades WHERE status='PENDING'");
    await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_one_pending_per_sender ON trades(user_a_id) WHERE status = \'PENDING\'');
  }

  // ============ Reject / sender cancel ============
  results.push('Qo\'shimcha — Reject, sender cancel, begona accept');
  {
    await clearCooldown('ali', 'sardor', 'zarina');
    const r = await C.ali.post('/api/trades/request', { username: 'sardor' });
    const wrong = await C.zarina.post(`/api/trades/${r.d.id}/accept`);
    check('Begona foydalanuvchi Accept qila olmaydi', wrong.s === 403);
    const selfAcc = await C.ali.post(`/api/trades/${r.d.id}/accept`);
    check('Yuboruvchi o\'z requestini Accept qila olmaydi', selfAcc.s === 403);
    const rej = await C.sardor.post(`/api/trades/${r.d.id}/reject`);
    check('Reject: PENDING -> REJECTED', rej.s === 200 && (await tradeRow(r.d.id)).status === 'REJECTED');
    const n = await C.ali.get('/api/trades/summary');
    check('Ali\'ga "rad etdi" bildirishnomasi', n.d.notifications.some(x => x.type === 'rejected'));
    const acc = await C.sardor.post(`/api/trades/${r.d.id}/accept`);
    check('REJECTED -> ACTIVE mumkin emas', acc.s === 409);
    await clearCooldown('ali');
    const r2 = await C.ali.post('/api/trades/request', { username: 'sardor' });
    const cn = await C.ali.post(`/api/trades/${r2.d.id}/cancel`);
    check('Yuboruvchi PENDING requestni bekor qila oladi', cn.s === 200 && (await tradeRow(r2.d.id)).status === 'CANCELLED');
    const acc2 = await C.sardor.post(`/api/trades/${r2.d.id}/accept`);
    check('Bekor qilingan requestni eski notification orqali Accept qilib bo\'lmaydi', acc2.s === 409);
  }

  // ============ Atomiklik / FAILED ============
  results.push('Atomik rollback — offer buzilsa FAILED, hech narsa yo\'qolmaydi');
  {
    const tf = await startTrade('ali', 'sardor');
    const aliG = await giftsOf('ali'); const sarG = await giftsOf('sardor');
    await C.ali.post(`/api/trades/${tf}/offer/gift`, { user_gift_id: aliG[0].id });
    await C.sardor.post(`/api/trades/${tf}/offer/gift`, { user_gift_id: sarG[0].id });
    await C.ali.put(`/api/trades/${tf}/offer/coin`, { amount: 77 });
    await C.sardor.put(`/api/trades/${tf}/offer/coin`, { amount: 33 });
    await C.ali.post(`/api/trades/${tf}/lock`); await C.sardor.post(`/api/trades/${tf}/lock`);
    const total0 = (await q('SELECT SUM(coin_balance) AS s FROM users'))[0].s;
    const gifts0 = (await q('SELECT COUNT(*) AS c FROM user_gifts'))[0].c;
    // Ali giftini admin o'chirib yubordi (yoki boshqa nosozlik) — offer buzildi
    await q('DELETE FROM user_gifts WHERE id=?', [aliG[0].id]);
    const v = await C.sardor.get(`/api/trades/${tf}`);
    check('Buzilgan gift offerda "missing" deb belgilanadi', v.d.their.gifts[0].missing === true);
    const cf = await C.ali.post(`/api/trades/${tf}/confirm`);
    check('Confirm: buzilgan offer aniqlandi -> FAILED qaytdi', cf.s === 409 && cf.d.code === 'FAILED', cf);
    const cf2 = await C.sardor.post(`/api/trades/${tf}/confirm`);
    check('Keyingi Confirm: trade endi faol emas (status FAILED)', cf2.s === 409 && cf2.d.status === 'FAILED', cf2);
    check('Status FAILED', (await tradeRow(tf)).status === 'FAILED');
    const total1 = (await q('SELECT SUM(coin_balance) AS s FROM users'))[0].s;
    check('Coinlar to\'liq egasiga qaytdi (escrow 110 coin qaytdi)', total1 === total0 + 77 + 33, [total0, total1]);
    check('Sardor giftini yo\'qotmadi va band holatdan chiqdi', (await q('SELECT * FROM user_gifts WHERE id=?', [sarG[0].id]))[0].trade_id === null);
    check('Gift sonida faqat o\'chirilgan (admin) gift kam', (await q('SELECT COUNT(*) AS c FROM user_gifts'))[0].c === gifts0 - 1);
    check('Hech qanday transfer yozuvi qolmadi (qisman bajarilish yo\'q)', (await q('SELECT COUNT(*) AS c FROM transfers WHERE trade_id=?', [tf]))[0].c === 0);
    check('trade_failed audit logga yozildi', (await q("SELECT COUNT(*) AS c FROM trade_logs WHERE trade_id=? AND action='trade_failed'", [tf]))[0].c === 1);
    check('trade_active_users tozalandi', (await activeRows()).length === 0);
  }

  // ============ Pet ovqatlantirish ============
  results.push('Test 8 (davomi) — Trade\'dagi gift pet\'ga yedirilmaydi');
  {
    const pt = (await admin.post('/api/admin/pet-types', { name: 'Kuchuk', price: 10, coin_per_3h: 1, xp_to_feed_full: 1, xp_per_level: 100, unlimited: true })).d;
    const buy = await C.sardor.post(`/api/pets/types/${pt.id}/buy`);
    const pets = await C.sardor.get('/api/pets/my');
    const petId = pets.d[0] && pets.d[0].id;
    const tg = await startTrade('sardor', 'zarina');
    const sg = (await giftsOf('sardor')).filter(g => g.gift_id === gDog.id);
    // Sardor'da shu gift'dan N ta bor; hammasini offerga solamiz (max 5)
    const inOffer = sg.slice(0, 5);
    for (const g of inOffer) await C.sardor.post(`/api/trades/${tg}/offer/gift`, { user_gift_id: g.id });
    const feed = await C.sardor.post(`/api/pets/${petId}/feed`, { gift_id: gDog.id, quantity: sg.length });
    check('Offerdagi giftlarni pet\'ga yedirib bo\'lmadi', feed.s === 400 || feed.s === 409, feed);
    const feedOne = sg.length > inOffer.length ? await C.sardor.post(`/api/pets/${petId}/feed`, { gift_id: gDog.id, quantity: 1 }) : { s: 'n/a' };
    check('Trade\'da bo\'lmagan gift bilan ovqatlantirish ishlaydi (agar mavjud bo\'lsa)', feedOne.s === 'n/a' || feedOne.s === 200, feedOne);
    check('Trade\'dagi giftlar saqlanib qoldi', (await q('SELECT COUNT(*) AS c FROM user_gifts WHERE trade_id=?', [tg]))[0].c === inOffer.length);
    await cleanup(tg, 'sardor');
  }

  // ============ Poygalar: sotish / offer / ikki marta sotish ============
  results.push('Poyga — bir vaqtda sotish va offerga qo\'shish; ikki marta sotish');
  {
    for (let i = 0; i < 6; i++) await C.ali.post(`/api/gifts/${gCat.id}/buy`, { quantity: 1 });
    const tr = await startTrade('ali', 'zarina');
    for (let round = 0; round < 3; round++) {
      const spare = (await giftsOf('ali')).filter(g => g.trade_id === null);
      if (!spare.length) break;
      const g = spare[0];
      const [sell, add] = await Promise.all([
        C.ali.post(`/api/inventory/gifts/${g.id}/sell`),
        C.ali.post(`/api/trades/${tr}/offer/gift`, { user_gift_id: g.id }),
      ]);
      const exists = (await q('SELECT * FROM user_gifts WHERE id=?', [g.id]))[0];
      const bothOk = sell.s === 200 && add.s === 200;
      check(`Poyga #${round + 1}: sotish va offer bir vaqtda -> ikkalasi o'tmadi (sell=${sell.s}, add=${add.s})`, !bothOk);
      check(`  ... natija izchil: ${sell.s === 200 ? 'gift sotildi va offerda emas' : 'gift offerda band'}`,
        sell.s === 200 ? (!exists && (await q('SELECT COUNT(*) AS c FROM trade_items WHERE user_gift_id=? AND trade_id=?', [g.id, tr]))[0].c === 0)
                       : (exists && exists.trade_id === tr));
    }
    await cleanup(tr);
    // Bir giftni ikki marta parallel sotish (mavjud kodda bo'lgan xato tuzatildi)
    const g2 = (await giftsOf('ali')).filter(x => x.trade_id === null)[0];
    const b0 = await balance('ali');
    const dbl = await Promise.all([C.ali.post(`/api/inventory/gifts/${g2.id}/sell`), C.ali.post(`/api/inventory/gifts/${g2.id}/sell`), C.ali.post(`/api/inventory/gifts/${g2.id}/sell`)]);
    check('Bir giftni 3 marta parallel sotish -> faqat bittasi o\'tdi', dbl.filter(r => r.s === 200).length === 1, dbl.map(r => r.s));
    const price = (await q('SELECT price FROM gifts WHERE id=?', [g2.gift_id]))[0].price;
    check('  ... coin faqat bir marta berildi', (await balance('ali')) === b0 + price * 0.8, [b0, await balance('ali')]);
    // Parallel yuborish: bir gift ikki kishiga ketmasin
    const g3 = (await giftsOf('ali')).filter(x => x.trade_id === null)[0];
    const snd = await Promise.all([
      C.ali.post('/api/transfers/gift', { to_username: 'sardor', inventory_id: g3.id }),
      C.ali.post('/api/transfers/gift', { to_username: 'zarina', inventory_id: g3.id }),
    ]);
    check('Bir giftni 2 kishiga parallel yuborish -> faqat bittasi o\'tdi', snd.filter(r => r.s === 200).length === 1, snd.map(r => r.s));
    check('  ... transfer tarixida ham bitta yozuv', (await q("SELECT COUNT(*) AS c FROM transfers WHERE gift_id=? AND item_type='gift' AND trade_id IS NULL AND from_user_id=?", [g3.gift_id, uid.ali]))[0].c >= 1);
  }

  // ============ Tarixni o'chirish ============
  results.push('Tarixni o\'chirish (faqat o\'z ko\'rinishidan)');
  {
    const before = (await C.ali.get('/api/trades/history')).d;
    check('Boshida Ali tarixida COMPLETED trade bor', before.some(x => x.id === t2));
    const del = await C.ali.del(`/api/trades/${t2}/history`);
    check('Ali tugagan trade\'ni tarixdan o\'chirdi', del.s === 200, del);
    const aliH = (await C.ali.get('/api/trades/history')).d;
    check('Ali tarixida endi ko\'rinmaydi', !aliH.some(x => x.id === t2));
    const sarH = (await C.sardor.get('/api/trades/history')).d;
    check('Sardor tarixida hali ham bor (sherikka ta\'sir qilmaydi)', sarH.some(x => x.id === t2));
    const adm = await admin.get(`/api/admin/trades?q=${t2}`);
    check('Admin audit tarixida saqlanib qoldi', adm.d.some(x => x.id === t2));
    const aliView = await C.ali.get(`/api/trades/${t2}`);
    check('Ali o\'chirgan trade ochilmaydi (404)', aliView.s === 404, aliView);
    const sarView = await C.sardor.get(`/api/trades/${t2}`);
    check('Sardor trade\'ni hamon ochadi', sarView.s === 200);
    const row = await tradeRow(t2);
    check('Trade bazada o\'chmagan, gift/coin yozuvlari saqlangan', row && row.status === 'COMPLETED' && (await q('SELECT COUNT(*) AS c FROM transfers WHERE trade_id=?', [t2]))[0].c === 5);
    const stranger = await C.zarina.del(`/api/trades/${t2}/history`);
    check('Begona foydalanuvchi o\'chira olmaydi (403)', stranger.s === 403);
    // faol trade o'chirilmaydi
    const ta = await startTrade('ali', 'sardor');
    const act = await C.ali.del(`/api/trades/${ta}/history`);
    check('ACTIVE trade tarixdan o\'chirilmaydi (409)', act.s === 409 && act.d.code === 'NOT_FINISHED', act);
    await clearCooldown('hasan', 'zarina');
    const pend = await C.zarina.post('/api/trades/request', { username: 'hasan' });
    const pdel = await C.zarina.del(`/api/trades/${pend.d.id}/history`);
    check('PENDING request tarixdan o\'chirilmaydi (409)', pdel.s === 409);
    await C.zarina.post(`/api/trades/${pend.d.id}/cancel`);
    await cleanup(ta);
    // hammasini tozalash: ACTIVE qolsin
    const tb = await startTrade('ali', 'sardor');
    const clr = await C.ali.del('/api/trades/history');
    check('Barcha tarixni tozalash ishladi', clr.s === 200 && clr.d.count >= 1, clr);
    const after = (await C.ali.get('/api/trades/history')).d;
    check('  ... tarixda faqat faol trade qoldi (qolganlari o\'chdi)', after.length === 1 && after[0].id === tb && after[0].status === 'ACTIVE', after);
    check('  ... faol trade saqlanib qoldi', (await tradeRow(tb)).status === 'ACTIVE');
    const sum = await C.ali.get('/api/trades/summary');
    check('  ... faol trade summary\'da ko\'rinadi', sum.d.active && sum.d.active.id === tb);
    await cleanup(tb);
  }

  // ============ Admin ============
  results.push('Admin — qidiruv, filter, ko\'rish');
  {
    const all = await admin.get('/api/admin/trades');
    check('Admin barcha trade\'larni ko\'radi', all.s === 200 && all.d.length >= 5);
    const byId = await admin.get(`/api/admin/trades?q=${t2}`);
    check('Trade ID bo\'yicha qidirish', byId.d.some(t => t.id === t2));
    const byUser = await admin.get('/api/admin/trades?q=zarina');
    check('Username bo\'yicha qidirish', byUser.d.length > 0 && byUser.d.every(t => t.a_name.includes('zarina') || t.b_name.includes('zarina')));
    const byStatus = await admin.get('/api/admin/trades?status=COMPLETED');
    check('Status filter', byStatus.d.length >= 1 && byStatus.d.every(t => t.status === 'COMPLETED'));
    const today = new Date().toISOString().slice(0, 10);
    const byDate = await admin.get(`/api/admin/trades?from=${today}&to=${today}`);
    check('Sana filter', byDate.d.length >= 1);
    const none = await admin.get('/api/admin/trades?from=2001-01-01&to=2001-01-02');
    check('Sana filter (bo\'sh natija)', none.d.length === 0);
    const det = await admin.get(`/api/admin/trades/${t2}`);
    check('Trade tafsiloti: items + audit loglar', det.s === 200 && det.d.items.length === 3 && det.d.logs.length >= 5);
    const u = await C.ali.get('/api/admin/trades');
    check('Oddiy user admin ro\'yxatini ko\'ra olmaydi', u.s === 403);
    // Admin trade holatini o'zgartira olmaydi (mutatsiya endpointi yo'q; admin ishtirokchi bo'lmasa 403)
    const am = await admin.post(`/api/trades/${t2}/cancel`);
    check('Admin ishtirokchi bo\'lmagan trade\'ni o\'zgartira olmaydi', am.s === 403, am);
  }

  // ============ Foydalanuvchini o'chirish ============
  results.push('Admin foydalanuvchini o\'chirsa ACTIVE trade bekor qilinadi');
  {
    const td = await startTrade('hasan', 'zarina');
    const hg = await C.hasan.get('/api/inventory/gifts');
    await C.hasan.put(`/api/trades/${td}/offer/coin`, { amount: 500 });
    await C.zarina.put(`/api/trades/${td}/offer/coin`, { amount: 40 });
    const zBefore = await balance('zarina');
    const del = await admin.del(`/api/admin/users/${uid.hasan}`);
    check('Foydalanuvchi o\'chirildi', del.s === 200, del);
    check('Sherik (Zarina) coini qaytdi', (await balance('zarina')) === zBefore + 40);
    check('Active qatorlar tozalandi', (await activeRows()).length === 0);
  }

  results.push('Bloklangan ishtirokchi — scheduler ACTIVE trade\'ni bekor qiladi');
  {
    const tb = await startTrade('zarina', 'sardor');
    await C.zarina.put(`/api/trades/${tb}/offer/coin`, { amount: 25 });
    const zb = await balance('zarina');
    await admin.put(`/api/admin/users/${uid.zarina}`, { is_blocked: true });
    await sleep(31000);
    const st = (await tradeRow(tb)).status;
    check('Bloklangan foydalanuvchi trade\'i avtomatik CANCELLED', st === 'CANCELLED', st);
    check('  ... escrow coin qaytdi', (await balance('zarina')) === zb + 25);
    check('  ... active qatorlar tozalandi', (await activeRows()).length === 0);
  }

  console.log(results.join('\n'));
  console.log(`\nNATIJA: ${pass} ta o'tdi, ${fail} ta xato`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST XATOSI', e); process.exit(2); });
