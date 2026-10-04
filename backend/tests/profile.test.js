// Emoji status + qadalgan giftlar testlari (backend + jsdom orqali frontend).
// OGOHLANTIRISH: faqat bo'sh TEST bazasida ishlating. jsdom kerak: npm i --no-save jsdom
//   export TURSO_DATABASE_URL=file:/tmp/profile-test.db JWT_SECRET=test PORT=4444
//   node src/seed-admin.js admin admin123 && node src/server.js &
//   node tests/profile.test.js
// Emoji status + qadalgan giftlar: backend va frontend (jsdom) testlari
const { JSDOM } = require('jsdom');
const { createClient } = require('@libsql/client');
const { CookieJar } = require('tough-cookie');
const B = process.env.TEST_URL || 'http://localhost:4444';
const raw = createClient({ url: process.env.TEST_DB || 'file:/tmp/profile-test.db' });
const q = async (sql, args = []) => { const r = await raw.execute({ sql, args }); return r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))); };
let pass = 0, fail = 0; const out = [];
const check = (n, c, x) => { c ? pass++ : fail++; out.push((c ? '  ✅ ' : '  ❌ ') + n + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const section = t => out.push(t);

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
  const mkUser = async (n) => { const r = await admin.post('/api/admin/users', { username: n, password: n + '123' }); await admin.post(`/api/admin/users/${r.d.id}/coin`, { amount: 100000, action: 'give' }); return { id: r.d.id, c: await login(n, n + '123'), name: n }; };
  const ali = await mkUser('qodirligi'), sar = await mkUser('sardor'), zar = await mkUser('zarina');

  // narxlar: chegaralarni tekshirish uchun
  const mkGift = async (name, price) => (await admin.post('/api/admin/gifts', { name, price, unlimited: true })).d;
  const g99 = await mkGift('Arzon 99', 99), g50 = await mkGift('Arzon 50', 50), g100 = await mkGift('Chegara 100', 100), g150 = await mkGift('Oraliq 150', 150);
  const g200 = await mkGift('Chegara 200', 200), g250 = await mkGift('Qimmat 250', 250), g900 = await mkGift('<b>Super</b> 900', 900);
  const buy = async (u, g, n = 1) => { for (let i = 0; i < n; i++) { const r = await u.c.post(`/api/gifts/${g.id}/buy`, { quantity: 1 }); if (r.s !== 200) throw new Error('buy ' + JSON.stringify(r)); } };
  await buy(ali, g50); await buy(ali, g99); await buy(ali, g100); await buy(ali, g150, 2); await buy(ali, g200); await buy(ali, g250, 2); await buy(ali, g900, 5);
  const inv = async (u) => (await q('SELECT ug.id, ug.gift_id FROM user_gifts ug WHERE ug.user_id=? ORDER BY ug.id', [u.id]));

  // ===== Emoji status =====
  section('Emoji status');
  {
    const e0 = await ali.c.get('/api/profile/edit');
    check('Profile edit ma\'lumoti keldi (limitlar 200/100/6)', e0.s === 200 && e0.d.limits.emoji_min_price === 200 && e0.d.limits.pin_min_price === 100 && e0.d.limits.pin_max === 6, e0.d);
    check('Emoji variantlari: narxi 200 va undan yuqori (200, 250, 900)', e0.d.emoji_options.map(o => o.name).sort().join('|') === '<b>Super</b> 900|Chegara 200|Qimmat 250', e0.d.emoji_options);
    const g199 = await mkGift('Arzon 199', 199); await buy(ali, g199);
    const r199 = await ali.c.put('/api/profile/emoji-status', { gift_id: g199.id });
    check('Narxi 199 bo\'lgan gift rad etildi (200 dan past)', r199.s === 400, r199);
    const r200 = await ali.c.put('/api/profile/emoji-status', { gift_id: g200.id });
    check('Narxi AYNAN 200 bo\'lgan gift emoji status bo\'ldi (200 va undan yuqori)', r200.s === 200, r200);
    const r50 = await ali.c.put('/api/profile/emoji-status', { gift_id: g50.id });
    check('Arzon gift (50) rad etildi', r50.s === 400);
    const notOwned = await sar.c.put('/api/profile/emoji-status', { gift_id: g250.id });
    check('Egasi bo\'lmagan foydalanuvchi qimmat giftni emoji qila olmaydi (403)', notOwned.s === 403, notOwned);
    for (const bad of ['abc', -1, 0, null, '1 OR 1=1', 999999]) {
      const r = await ali.c.put('/api/profile/emoji-status', { gift_id: bad });
      if (![400, 404].includes(r.s)) check('Noto\'g\'ri gift_id ' + JSON.stringify(bad), false, r);
    }
    check('Noto\'g\'ri/mavjud bo\'lmagan gift_id\'lar rad etildi', true);
    const ok = await ali.c.put('/api/profile/emoji-status', { gift_id: g250.id });
    check('250 coinli gift emoji status bo\'ldi', ok.s === 200 && ok.d.emoji.gift_id === g250.id, ok);
    const me = await ali.c.get('/api/auth/me');
    check('/auth/me da emoji_gift_id ko\'rinadi', me.d.emoji_gift_id === g250.id);
    const search = await sar.c.get('/api/users/search?q=qodir');
    check('Profil qidirishda emoji status ko\'rinadi', search.d.length === 1 && search.d[0].username === 'qodirligi' && search.d[0].emoji_gift_id === g250.id, search.d);
    const prof = await sar.c.get('/api/users/qodirligi/profile');
    check('Ochiq profilda emoji status bor', prof.d.emoji && prof.d.emoji.gift_id === g250.id);
    const other = await sar.c.get('/api/users/search?q=zarin');
    check('Emoji qo\'ymagan foydalanuvchida emoji_gift_id = null', other.d[0].emoji_gift_id === null);
    // gift rasmi endpointi
    const imgRes = await fetch(B + `/api/gift-image/${g250.id}`, { headers: { Cookie: sar.c.jar.getCookieStringSync(B) } });
    check('Gift rasmi endpointi javob beradi (rasm yo\'q bo\'lsa 404, xato emas)', [200, 404].includes(imgRes.status));
    // Emoji'ni boshqa foydalanuvchi o'zgartira olmaydi: faqat o'z hisobiga
    const hack = await sar.c.put('/api/profile/emoji-status', { gift_id: g250.id, user_id: ali.id });
    check('Boshqa user_id yuborib o\'zgartirib bo\'lmaydi (faqat o\'z profili)', hack.s === 403 && (await q('SELECT emoji_gift_id FROM users WHERE id=?', [ali.id]))[0].emoji_gift_id === g250.id);

    // narx pasaysa / gift sotilsa yo'qoladi
    await admin.put(`/api/admin/gifts/${g250.id}`, { price: 150 });
    const afterCheap = await sar.c.get('/api/users/qodirligi/profile');
    check('Gift narxi 200 dan pasaysa emoji status ko\'rinmaydi', afterCheap.d.emoji === null);
    await admin.put(`/api/admin/gifts/${g250.id}`, { price: 250 });
    check('Narx qaytsa yana ko\'rinadi', (await sar.c.get('/api/users/qodirligi/profile')).d.emoji !== null);

    // 2 ta nusxa bor: bittasini sotsa hali ko'rinadi, ikkalasini sotsa yo'qoladi
    const copies = (await inv(ali)).filter(x => x.gift_id === g250.id);
    await ali.c.post(`/api/inventory/gifts/${copies[0].id}/sell`);
    check('Bitta nusxa sotildi, ikkinchisi qolgan -> emoji saqlanadi', (await sar.c.get('/api/users/qodirligi/profile')).d.emoji !== null);
    await ali.c.post(`/api/inventory/gifts/${copies[1].id}/sell`);
    const gone = await sar.c.get('/api/users/qodirligi/profile');
    check('Oxirgi nusxa sotilgach emoji status avtomatik yo\'qoldi', gone.d.emoji === null);
    const gone2 = await sar.c.get('/api/users/search?q=qodir');
    check('  ... qidiruvda ham yo\'q', gone2.d[0].emoji_gift_id === null);
    check('  ... /auth/me da ham yo\'q', (await ali.c.get('/api/auth/me')).d.emoji_gift_id === null);

    // 900 lik gift: qo'yish, sherikka yuborish -> yo'qolishi, olib tashlash
    await ali.c.put('/api/profile/emoji-status', { gift_id: g900.id });
    check('900 coinli gift emoji bo\'ldi', (await ali.c.get('/api/auth/me')).d.emoji_gift_id === g900.id);
    const clr = await ali.c.del('/api/profile/emoji-status');
    check('Emoji status olib tashlandi', clr.s === 200 && (await ali.c.get('/api/auth/me')).d.emoji_gift_id === null);
  }

  // ===== Qadash =====
  section('Profilga gift qadash 📌');
  {
    let items = await inv(ali);
    const find = (gid, n = 0) => items.filter(x => x.gift_id === gid)[n];
    const e = await ali.c.get('/api/profile/edit');
    const names = e.d.pin_options.map(o => o.name);
    check('Qadash variantlari: narxi 100 va undan yuqori (100, 150, 200, 900); 99 va 50 yo\'q', !names.includes('Arzon 50') && !names.includes('Arzon 99') && names.includes('Chegara 100') && names.includes('Oraliq 150') && names.includes('Chegara 200'), names);
    const p50 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g50.id).id });
    check('50 coinli gift qadalmaydi (400)', p50.s === 400, p50);
    const p99 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g99.id).id });
    check('99 coinli gift qadalmaydi (400)', p99.s === 400, p99);
    const p100 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g100.id).id });
    check('Narxi AYNAN 100 bo\'lgan gift qadaladi (100 ham bo\'ladi)', p100.s === 200, p100);
    check('  ... ochiq profilda ko\'rinadi', (await sar.c.get('/api/users/qodirligi/profile')).d.pins.some(p => p.name === 'Chegara 100'));
    await admin.put(`/api/admin/gifts/${g100.id}`, { price: 99 });
    check('  ... narxi 99 ga tushsa profildan yo\'qoladi', !(await sar.c.get('/api/users/qodirligi/profile')).d.pins.some(p => p.name === 'Chegara 100'));
    await admin.put(`/api/admin/gifts/${g100.id}`, { price: 100 });
    check('  ... narx yana 100 bo\'lsa qaytib ko\'rinadi (qadash yozuvi saqlangan)', (await sar.c.get('/api/users/qodirligi/profile')).d.pins.some(p => p.name === 'Chegara 100'));
    const un100 = await ali.c.del(`/api/profile/pins/${find(g100.id).id}`);
    check('  ... olib tashlandi (keyingi testlar uchun)', un100.s === 200);
    const steal = await sar.c.post('/api/profile/pins', { user_gift_id: find(g150.id).id });
    check('Boshqa foydalanuvchining giftini qadab bo\'lmaydi (404)', steal.s === 404, steal);
    for (const bad of ['abc', -3, 0, null, '5; DROP TABLE users', 99999999]) {
      const r = await ali.c.post('/api/profile/pins', { user_gift_id: bad });
      if (![400, 404].includes(r.s)) check('Noto\'g\'ri user_gift_id ' + JSON.stringify(bad), false, r);
    }
    check('Noto\'g\'ri user_gift_id\'lar rad etildi', true);
    const ok1 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g150.id, 0).id });
    check('150 coinli gift qadaldi', ok1.s === 200, ok1);
    const dup = await ali.c.post('/api/profile/pins', { user_gift_id: find(g150.id, 0).id });
    check('Bir xil nusxani ikki marta qadab bo\'lmaydi (409)', dup.s === 409, dup);
    const dupPar = await Promise.all([1, 2, 3].map(() => ali.c.post('/api/profile/pins', { user_gift_id: find(g150.id, 1).id })));
    check('Parallel 3 ta qadash -> faqat bittasi o\'tdi', dupPar.filter(r => r.s === 200).length === 1, dupPar.map(r => r.s));
    // limit 6
    await ali.c.post('/api/profile/pins', { user_gift_id: find(g200.id).id });
    for (let i = 0; i < 2; i++) await ali.c.post('/api/profile/pins', { user_gift_id: find(g900.id, i).id });
    const six = await ali.c.get('/api/profile/edit');
    check('Hozir 5 ta qadalgan (150, 150, 200, 900, 900)', six.d.pins.length === 5, six.d.pins.length);
    const p6 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g900.id, 2).id });
    check('6-chi qadash o\'tdi', p6.s === 200);
    const p7 = await ali.c.post('/api/profile/pins', { user_gift_id: find(g900.id, 3).id });
    check('7-chi qadash rad etildi (maks 6)', p7.s === 400 && /6/.test(p7.d.error), p7);
    const racePins = await Promise.all([find(g900.id, 3).id, find(g900.id, 4).id].map(id => ali.c.post('/api/profile/pins', { user_gift_id: id })));
    check('Limit poygasi: to\'lgan bo\'lsa hech biri o\'tmaydi', racePins.every(r => r.s === 400), racePins.map(r => r.s));
    check('Bazada aynan 6 ta qadalgan', (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [ali.id]))[0].c === 6);

    const pub = await sar.c.get('/api/users/qodirligi/profile');
    check('Ochiq profilda 6 ta qadalgan gift ko\'rinadi', pub.d.pins.length === 6, pub.d.pins.length);
    check('  ... narx/ID emas, faqat gift_id va nom beriladi', Object.keys(pub.d.pins[0]).sort().join() === 'gift_id,name', Object.keys(pub.d.pins[0]));

    // unpin
    const first = (await ali.c.get('/api/profile/edit')).d.pins[0];
    const un = await ali.c.del(`/api/profile/pins/${first.user_gift_id}`);
    check('Qadash olib tashlandi', un.s === 200 && (await sar.c.get('/api/users/qodirligi/profile')).d.pins.length === 5);
    const unOther = await sar.c.del(`/api/profile/pins/${(await ali.c.get('/api/profile/edit')).d.pins[0].user_gift_id}`);
    check('Boshqa foydalanuvchi qadashni olib tashlay olmaydi (404)', unOther.s === 404);
    check('  ... Ali\'ning qadashlari saqlanib qoldi', (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [ali.id]))[0].c === 5);

    // qadalgan gift sotilsa / yuborilsa — profildan yo'qoladi
    const pinsNow = (await ali.c.get('/api/profile/edit')).d.pins;
    const sellId = pinsNow[0].user_gift_id; const sendId = pinsNow[1].user_gift_id;
    await ali.c.post(`/api/inventory/gifts/${sellId}/sell`);
    const sendRes = await ali.c.post('/api/transfers/gift', { to_username: 'zarina', inventory_id: sendId });
    check('Gift yuborildi', sendRes.s === 200, sendRes);
    const after = await sar.c.get('/api/users/qodirligi/profile');
    check('Sotilgan va yuborilgan giftlar profildan yo\'qoldi (5 -> 3)', after.d.pins.length === 3, after.d.pins.length);
    const zp = await sar.c.get('/api/users/zarina/profile');
    check('Yuborilgan gift Zarina profilida QADALMAGAN bo\'lib chiqadi', zp.d.pins.length === 0, zp.d.pins);
    check('Qadash yozuvlari lazy tozalandi (qolgani 3)', (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [ali.id]))[0].c === 3);

    // narx pasayishi qadashni olib tashlaydi
    await admin.put(`/api/admin/gifts/${g150.id}`, { price: 90 });
    const cheap = await sar.c.get('/api/users/qodirligi/profile');
    check('Gift narxi 100 dan pasaysa qadash ko\'rinmaydi', !cheap.d.pins.some(p => p.name === 'Oraliq 150'));
    await admin.put(`/api/admin/gifts/${g150.id}`, { price: 150 });

    // trade bilan ketsa
    const tpin = (await ali.c.get('/api/profile/edit')).d.pins;
    const tradeGift = tpin[0];
    await q('UPDATE users SET last_trade_request_at=NULL');
    const rq = await ali.c.post('/api/trades/request', { username: 'sardor' });
    await sar.c.post(`/api/trades/${rq.d.id}/accept`);
    await ali.c.post(`/api/trades/${rq.d.id}/offer/gift`, { user_gift_id: tradeGift.user_gift_id });
    await ali.c.post(`/api/trades/${rq.d.id}/lock`); await sar.c.post(`/api/trades/${rq.d.id}/lock`);
    await ali.c.post(`/api/trades/${rq.d.id}/confirm`); await sar.c.post(`/api/trades/${rq.d.id}/confirm`);
    check('Trade bilan ketgan gift Ali profilidan yo\'qoldi', !(await sar.c.get('/api/users/qodirligi/profile')).d.pins.some(p => p.name === tradeGift.name) || (await ali.c.get('/api/profile/edit')).d.pins.every(p => p.user_gift_id !== tradeGift.user_gift_id));
    check('Sardor profilida u qadalgan emas', (await sar.c.get('/api/users/sardor/profile')).d.pins.length === 0);
  }

  // ===== Admin foydalanuvchini o'chirsa =====
  section('Admin foydalanuvchini o\'chirishi');
  {
    const x = await mkUser('vaqtincha');
    await buy(x, g900); const ug = (await inv(x))[0];
    await x.c.post('/api/profile/pins', { user_gift_id: ug.id });
    const d = await admin.del(`/api/admin/users/${x.id}`);
    check('Qadalgan giftli foydalanuvchi muammosiz o\'chirildi', d.s === 200, d);
    check('  ... qadash yozuvlari ham o\'chdi', (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [x.id]))[0].c === 0);
  }

  // ===== Frontend (jsdom) =====
  section('Frontend: Profile edit oqimi');
  {
    // Ali'ga yana gift beramiz
    await buy(ali, g250, 1);
    const jar = ali.c.jar; const errors = [];
    const dom = await JSDOM.fromURL(B + '/index.html', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar,
      beforeParse(w) {
        w.fetch = (url, opts = {}) => fetch(String(url).startsWith('http') ? url : B + url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Cookie: jar.getCookieStringSync(B) }) }));
        w.confirm = () => true; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {}; w.Element.prototype.scrollTo = function () {}; w.Element.prototype.scrollBy = function () {};
        w.addEventListener('error', e => errors.push(e.message)); w.console.error = (...a) => errors.push(a.join(' '));
      },
    });
    const w = dom.window, d = w.document;
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(100); } return null; };
    const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('');

    await waitFor(() => d.getElementById('main') && d.getElementById('main').children.length);
    w.eval("renderTab('profils')");
    const editBtn = await waitFor(() => [...d.querySelectorAll('#main button')].find(b => /Profile edit/.test(b.textContent)));
    check('Profils sahifasida "✏️ Profile edit" tugmasi bor', !!editBtn);
    click(editBtn);
    const emojiBtn = await waitFor(() => d.getElementById('peEmoji'));
    check('Profile edit ichida "Add emoji status" va "Gift 📌" bor', !!emojiBtn && /Add emoji status/.test(emojiBtn.textContent) && /Gift 📌/.test(d.getElementById('pePin').textContent));

    click(emojiBtn);
    const rows = await waitFor(() => d.querySelectorAll('#modalBody .tr-pick-row[data-gid]').length ? d.querySelectorAll('#modalBody .tr-pick-row[data-gid]') : null);
    check('Emoji status ro\'yxati: faqat 200 dan qimmat giftlar (2 xil: 250 va 900)', rows && rows.length === 2, rows && rows.length);
    check('  ... rasmlar kichik .tr-thumb ichida (katta bo\'lib ketmaydi)', [...d.querySelectorAll('#modalBody img')].every(i => i.closest('.tr-thumb')));
    click(rows[0]);
    const badgeSet = await waitFor(() => d.querySelector('#main .page-sub .emo-st img'));
    check('Emoji tanlangach Profils sarlavhasida username yonida paydo bo\'ldi', !!badgeSet);
    check('  ... CSS: .emo-st 20x20 px', /\.emo-st \{[^}]*width: 20px[^}]*height: 20px/.test(css) && /\.emo-st img \{[^}]*width: 100%/.test(css));
    check('  ... "Joriy" gift ko\'rinadi va olib tashlash tugmasi bor', !!d.getElementById('peEmojiClear'));

    // Qidiruv natijasida ko'rinadi
    w.eval("closeModal()");
    w.eval("runUserSearch('qodir')");
    const srch = await waitFor(() => d.querySelector('#userSearchResults .ci-name .emo-st'));
    check('Profil qidirishda @qodirligi yonida emoji status ko\'rinadi', !!srch);

    // Pin oqimi
    w.eval("openProfileEdit()");
    click(await waitFor(() => d.getElementById('pePin')));
    const addBtn = await waitFor(() => d.getElementById('pePinAdd'));
    check('Gift 📌 ekrani: joriy qadalganlar va "Gift qadash" tugmasi', !!addBtn && /\/6/.test(d.getElementById('modalBody').textContent));
    click(addBtn);
    const pr = await waitFor(() => d.querySelectorAll('#modalBody .tr-pick-row[data-ug]').length ? d.querySelectorAll('#modalBody .tr-pick-row[data-ug]') : null);
    check('Qadash ro\'yxati: faqat 100 dan qimmat bo\'sh giftlar', !!pr && pr.length > 0);
    const before = (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [ali.id]))[0].c;
    click(pr[0]);
    await waitFor(async () => true);
    await sleep(800);
    const afterPins = (await q('SELECT COUNT(*) AS c FROM profile_pins WHERE user_id=?', [ali.id]))[0].c;
    check('Gift tanlanganda profilga qadaldi', afterPins === before + 1, [before, afterPins]);

    // Boshqa foydalanuvchi profilini ochish
    const jar2 = sar.c.jar;
    const dom2 = await JSDOM.fromURL(B + '/index.html', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar2,
      beforeParse(w2) {
        w2.fetch = (url, opts = {}) => fetch(String(url).startsWith('http') ? url : B + url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Cookie: jar2.getCookieStringSync(B) }) }));
        w2.confirm = () => true; w2.scrollTo = () => {}; w2.Element.prototype.scrollIntoView = () => {}; w2.Element.prototype.scrollTo = function () {}; w2.Element.prototype.scrollBy = function () {};
        w2.console.error = () => {};
      },
    });
    const w2 = dom2.window, d2 = w2.document;
    await waitFor(() => d2.getElementById('main') && d2.getElementById('main').children.length);
    w2.eval("openUserProfile('qodirligi')");
    const title = await waitFor(() => d2.querySelector('#modalBody .modal-title .emo-st'));
    check('Sardor Ali profilini ochganda username yonida emoji status ko\'rinadi', !!title);
    const grid = await waitFor(() => d2.querySelector('#modalBody .pin-grid .pin-tile'));
    check('  ... "📌 Qadalgan giftlar" bo\'limi va tile\'lar bor', !!grid && /Qadalgan giftlar/.test(d2.getElementById('modalBody').textContent));
    check('  ... qadalgan giftlar 3 ustunli kichik tile (rasm .tr-thumb ichida)', [...d2.querySelectorAll('#modalBody .pin-tile img')].every(i => i.closest('.tr-thumb')) && /\.pin-grid \{[^}]*repeat\(3/.test(css));
    check('  ... gift nomi HTML sifatida chizilmadi (<b> yaratilmadi)', !d2.querySelector('#modalBody .pin-tile b') && [...d2.querySelectorAll('#modalBody .pin-name')].some(x => x.textContent.includes('<b>Super</b>')));
    check('Sahifada JS xatolari yo\'q', errors.filter(e => !/Not implemented|Could not load/i.test(e)).length === 0, errors.slice(0, 4));
  }

  // ===== Trade xonasi va bannerlarda emoji status =====
  section('Trade xonasi va bannerlarda emoji status');
  {
    await ali.c.put('/api/profile/emoji-status', { gift_id: g900.id });
    await buy(sar, g250);
    await sar.c.put('/api/profile/emoji-status', { gift_id: g250.id });
    await q('UPDATE users SET last_trade_request_at=NULL');
    await q("UPDATE trades SET status='CANCELLED' WHERE status IN ('PENDING','ACTIVE')");
    await q('DELETE FROM trade_active_users');
    const rq = await ali.c.post('/api/trades/request', { username: 'sardor' });
    check('Trade request yuborildi', rq.s === 200, rq);

    const sumIn = await sar.c.get('/api/trades/summary');
    check('API: kiruvchi request\'da yuboruvchining emoji_gift_id bor', sumIn.d.incoming[0] && sumIn.d.incoming[0].emoji_gift_id === g900.id, sumIn.d.incoming);
    const sumOut = await ali.c.get('/api/trades/summary');
    check('API: chiquvchi request\'da qabul qiluvchining emoji_gift_id bor', sumOut.d.outgoing && sumOut.d.outgoing.emoji_gift_id === g250.id, sumOut.d.outgoing);

    // Sardor sahifasi: banner
    const jar = sar.c.jar;
    const dom = await JSDOM.fromURL(B + '/index.html', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar,
      beforeParse(w) {
        w.fetch = (url, opts = {}) => fetch(String(url).startsWith('http') ? url : B + url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Cookie: jar.getCookieStringSync(B) }) }));
        w.confirm = () => true; w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {}; w.Element.prototype.scrollTo = function () {}; w.Element.prototype.scrollBy = function () {};
        w.console.error = () => {};
      },
    });
    const w = dom.window, d = w.document;
    const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(100); } return null; };
    const banner = await waitFor(() => d.querySelector('#tradeBanner .tb .tb-t .emo-st img'));
    check('Banner (kiruvchi request): @qodirligi yonida emoji status ko\'rinadi', !!banner);
    check('  ... rasm 20px o\'ramda (katta bo\'lib ketmaydi)', !!banner && banner.closest('.emo-st') !== null);

    click([...d.querySelectorAll('#tradeBanner button')].find(b => /Qabul/.test(b.textContent)));
    const vs = await waitFor(() => d.querySelectorAll('#trVs .emo-st').length === 2 ? d.getElementById('trVs') : null);
    check('Trade xonasi sarlavhasida ikkala foydalanuvchi emoji statusi ko\'rinadi', !!vs);
    check('  ... matn: @sardor ↔ @qodirligi', !!vs && /@sardor\s*↔\s*@qodirligi/.test(vs.textContent), vs && vs.textContent);

    // Ali sahifasi: chiquvchi banner / faol trade pill
    const jarA = ali.c.jar;
    const domA = await JSDOM.fromURL(B + '/index.html', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jarA,
      beforeParse(w2) {
        w2.fetch = (url, opts = {}) => fetch(String(url).startsWith('http') ? url : B + url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Cookie: jarA.getCookieStringSync(B) }) }));
        w2.confirm = () => true; w2.scrollTo = () => {}; w2.Element.prototype.scrollIntoView = () => {}; w2.Element.prototype.scrollTo = function () {}; w2.Element.prototype.scrollBy = function () {};
        w2.console.error = () => {};
      },
    });
    const dA = domA.window.document;
    const pill = await waitFor(() => dA.querySelector('#tradeBanner .tb .tb-t .emo-st img'));
    check('Banner (faol trade): @sardor yonida emoji status ko\'rinadi', !!pill && /davom etmoqda/.test(dA.querySelector('#tradeBanner .tb-t').textContent));
    const act = await ali.c.get('/api/trades/summary');
    check('API: faol trade\'da sherikning emoji_gift_id bor', act.d.active && act.d.active.emoji_gift_id === g250.id, act.d.active);
    const view = await ali.c.get(`/api/trades/${rq.d.id}`);
    check('API: trade xonasida me/other emoji_gift_id', view.d.me.emoji_gift_id === g900.id && view.d.other.emoji_gift_id === g250.id, [view.d.me, view.d.other]);

    // Emoji o'chirilsa xonada ham yo'qoladi
    await sar.c.del('/api/profile/emoji-status');
    const view2 = await ali.c.get(`/api/trades/${rq.d.id}`);
    check('Sherik emoji statusni olib tashlasa, xonada ham yo\'qoladi', view2.d.other.emoji_gift_id === null);
    await ali.c.post(`/api/trades/${rq.d.id}/cancel`);
  }

  // ===== Admin ikonka o'lchami =====
  section('Admin paneldagi status ikonkasi');
  {
    const html = await (await fetch(B + '/admin.html')).text();
    check('admin.html: .user-row rasmi 36px bilan cheklangan', /\.user-row > img[^{]*\{[^}]*width: 36px[^}]*height: 36px[^}]*max-width: 36px/.test(html));
    check('  ... img.ci-icon ham cheklangan (klass admin CSS\'da bo\'lmagani sabab edi)', /img\.ci-icon/.test(html));
  }

  console.log(out.join('\n'));
  console.log(`\nNATIJA: ${pass} ta o'tdi, ${fail} ta xato`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST XATOSI', e); process.exit(2); });
