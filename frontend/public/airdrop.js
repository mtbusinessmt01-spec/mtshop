// AirDrop: yaqin foydalanuvchiga gift tashlash.
// index.html dagi global funksiyalarga tayanadi: openPage, closeModal, showToast, esc, stAvatar,
// giftImg, API_BASE, currentUser, REDUCED_MOTION. Shu faylni asosiy <script> dan KEYIN ulang.
(function () {
  const css = document.createElement('style');
  css.textContent = `
  .ad-wrap { max-width:480px; margin:0 auto; padding:4px 2px 28px; }

  /* --- Holat chipi --- */
  .ad-top { display:flex; align-items:center; gap:8px; margin:6px 0 4px; }
  .ad-chip { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border-radius:999px; border:0; font:inherit; font-size:13px; font-weight:600; cursor:pointer;
    color:#fff; background:rgba(255,255,255,.1); }
  .ad-chip.good { background:rgba(46,204,113,.2); color:#58e39a; } .ad-chip.mid { background:rgba(245,165,36,.2); color:#ffc15a; }
  .ad-chip.bad { background:rgba(231,76,60,.2); color:#ff8a7d; }
  .ad-snd { margin-left:auto; width:36px; height:36px; border-radius:50%; border:0; background:rgba(255,255,255,.1); font-size:17px; cursor:pointer; color:inherit; }
  .ad-tip { font-size:13px; line-height:1.45; opacity:.8; margin:4px 4px 10px; display:none; }
  .ad-tip.show { display:block; }

  /* --- Radar --- */
  .ad-radar { position:relative; height:290px; border-radius:30px; margin:10px 0 16px; overflow:hidden;
    background: radial-gradient(circle at 50% 50%, rgba(108,92,231,.30), transparent 68%), var(--glass-bg, rgba(255,255,255,.05));
    border:1px solid var(--glass-border, rgba(255,255,255,.12)); }
  .ad-radar::before, .ad-radar::after { content:''; position:absolute; left:50%; top:50%; width:150px; height:150px; margin:-75px 0 0 -75px;
    border-radius:50%; border:2px solid rgba(162,155,254,.55); animation: adPulse 3s ease-out infinite; }
  .ad-radar::after { animation-delay:1.5s; }
  @keyframes adPulse { from { transform:scale(.35); opacity:.9; } to { transform:scale(2.3); opacity:0; } }
  .ad-ring { position:absolute; left:50%; top:50%; border-radius:50%; border:1px dashed rgba(255,255,255,.1); transform:translate(-50%,-50%); }
  .ad-me { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:5px; z-index:2; }
  .ad-me .st-avatar, .ad-person .st-avatar { border-radius:50%; object-fit:cover; }
  .ad-me .st-avatar { box-shadow:0 0 0 4px rgba(162,155,254,.35), 0 0 28px rgba(108,92,231,.7); }
  .ad-me span { font-size:11px; font-weight:700; letter-spacing:.4px; opacity:.85; }
  .ad-person { position:absolute; z-index:3; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:4px; width:76px;
    background:none; border:0; color:inherit; font:inherit; cursor:pointer; transition:left .6s ease, top .6s ease;
    animation: adPop .5s cubic-bezier(.2,1.6,.4,1) both; }
  .ad-person.leave { animation: adLeave .3s ease forwards; pointer-events:none; }
  @keyframes adPop { from { opacity:0; transform:translate(-50%,-50%) scale(0); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
  @keyframes adLeave { to { opacity:0; transform:translate(-50%,-50%) scale(.4); } }
  .ad-person .st-avatar { border:3px solid transparent; transition:border-color .2s, box-shadow .2s, transform .2s; }
  .ad-person.sel .st-avatar { border-color:#a29bfe; box-shadow:0 0 22px rgba(162,155,254,.9); transform:scale(1.12); }
  .ad-person span { font-size:11px; max-width:76px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.9; }
  .ad-empty { position:absolute; left:0; right:0; bottom:16px; z-index:2; text-align:center; font-size:13px; line-height:1.45; opacity:.8; padding:0 20px; transition:opacity .3s; }
  .ad-empty b { display:block; font-size:15px; margin-bottom:2px; } .ad-empty.hide { opacity:0; pointer-events:none; }

  /* --- Giftlar: qirrasiz, yumaloq --- */
  .ad-gifts { display:flex; gap:12px; overflow-x:auto; padding:8px 4px 16px; scroll-snap-type:x proximity; }
  .ad-gift { flex:none; width:118px; scroll-snap-align:start; text-align:center; border:0; border-radius:30px; padding:14px 8px 12px; cursor:pointer; color:inherit; font:inherit;
    background:var(--glass-bg, rgba(255,255,255,.07)); box-shadow:0 6px 18px rgba(0,0,0,.25); transition:transform .2s, box-shadow .2s; }
  .ad-gift.sel { transform:translateY(-4px) scale(1.05); box-shadow:0 0 0 3px #a29bfe, 0 10px 28px rgba(108,92,231,.55); }
  .ad-orb { width:84px; height:84px; margin:0 auto 8px; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center;
    background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.28), rgba(108,92,231,.25) 70%); }
  .ad-orb img { width:100%; height:100%; object-fit:cover; border-radius:50%; display:block; }
  .ad-orb .gift-img-fallback { font-size:46px; line-height:84px; }
  .ad-gift b { display:block; font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ad-none { width:100%; text-align:center; padding:18px 10px 8px; font-size:14px; opacity:.9; }
  .ad-none .big { font-size:42px; display:block; margin-bottom:6px; }
  .ad-none .btn { margin-top:12px; }

  /* --- Tashlash maydoni --- */
  .ad-stage { position:relative; min-height:200px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:10px; touch-action:none; user-select:none; -webkit-user-select:none; }
  .ad-hint { font-size:13px; opacity:.75; animation: adBob 1.6s ease-in-out infinite; }
  @keyframes adBob { 50% { transform:translateY(-6px); opacity:1; } }
  .ad-puck { width:116px; height:116px; border-radius:50%; overflow:hidden; cursor:grab; touch-action:none; will-change:transform;
    box-shadow:0 12px 34px rgba(108,92,231,.6), 0 0 0 4px rgba(255,255,255,.18); background:#2a2358; }
  .ad-puck img { width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
  .ad-puck .gift-img-fallback { font-size:60px; line-height:116px; text-align:center; pointer-events:none; }
  .ad-puck.fly { transition: transform .55s cubic-bezier(.2,.8,.2,1), opacity .55s ease-in; opacity:0; }
  .ad-puck.back { transition: transform .35s cubic-bezier(.3,1.6,.5,1); }
  .ad-to { font-size:13px; opacity:.85; } .ad-to b { font-weight:700; }
  .ad-wait { display:flex; flex-direction:column; align-items:center; gap:8px; padding-bottom:6px; font-size:14px; }
  .ad-wait .box { position:relative; width:84px; height:84px; }
  .ad-wait .st-avatar { position:absolute; left:14px; top:14px; border-radius:50%; object-fit:cover; }
  .ad-wait svg { position:absolute; inset:0; transform:rotate(-90deg); }
  .ad-wait circle { fill:none; stroke-width:4; }
  .ad-wait .bg { stroke:rgba(255,255,255,.15); } .ad-wait .fg { stroke:#a29bfe; stroke-linecap:round; stroke-dasharray:226; stroke-dashoffset:0; animation: adCount linear forwards; }
  @keyframes adCount { to { stroke-dashoffset:226; } }

  /* --- Nur: tepadan tushadi (yuboruvchida iliq, qabul qiluvchida sovuq) --- */
  #adLight { position:fixed; inset:0; z-index:1500; pointer-events:none; --lv:0; }
  #adLight .top { position:absolute; left:0; right:0; top:-14px; height:calc(var(--lv) * 78vh + 14px); opacity:calc(var(--lv) * 1.05); filter:blur(7px);
    transition:height .14s linear, opacity .14s linear; }
  #adLight .rim { position:absolute; inset:0; opacity:var(--lv); transition:opacity .14s linear; }
  #adLight.warm .top { background: radial-gradient(ellipse 85% 100% at 50% 0%, rgba(255,170,70,.95), rgba(255,95,120,.45) 48%, transparent 78%); }
  #adLight.warm .rim { box-shadow: inset 0 0 70px 6px rgba(255,140,60,.55), inset 0 4px 0 0 rgba(255,200,120,.9); }
  #adLight.cool .top { background: radial-gradient(ellipse 85% 100% at 50% 0%, rgba(90,175,255,.95), rgba(125,95,255,.45) 48%, transparent 78%); }
  #adLight.cool .rim { box-shadow: inset 0 0 70px 6px rgba(90,160,255,.55), inset 0 4px 0 0 rgba(170,210,255,.9); }
  #adLight.slow .top, #adLight.slow .rim { transition-duration:.7s; }

  /* --- Qabul qiluvchi: gift tepadan tushadi --- */
  .ad-incoming { position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; background:rgba(8,6,20,.72);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: adFade .25s ease; }
  @keyframes adFade { from { opacity:0 } }
  .ad-card { width:min(320px, 88vw); text-align:center; padding:26px 20px 20px; border-radius:30px; color:#fff;
    background: linear-gradient(160deg, rgba(108,92,231,.92), rgba(40,30,110,.95)); box-shadow:0 20px 60px rgba(0,0,0,.5); position:relative; }
  .ad-fall { width:128px; height:128px; margin:-90px auto 10px; border-radius:50%; overflow:hidden; animation: adFall .9s cubic-bezier(.22,1.4,.4,1) both; box-shadow:0 14px 26px rgba(0,0,0,.4); background:#2a2358; }
  .ad-fall img { width:100%; height:100%; object-fit:cover; display:block; }
  .ad-fall .gift-img-fallback { font-size:80px; line-height:128px; }
  @keyframes adFall { 0% { transform: translateY(-110vh) rotate(-18deg) scale(.6); } 70% { transform: translateY(8px) rotate(4deg) scale(1.05); } 100% { transform:none; } }
  .ad-card h3 { margin:6px 0 2px; font-size:20px; } .ad-card p { margin:0 0 14px; opacity:.85; font-size:14px; }
  .ad-row { display:flex; gap:10px; } .ad-row .btn { margin:0; flex:1; }
  .ad-timer { height:4px; border-radius:4px; background:rgba(255,255,255,.2); margin-top:14px; overflow:hidden; }
  .ad-timer i { display:block; height:100%; background:#fff; animation: adTimer linear forwards; }
  @keyframes adTimer { from { width:100% } to { width:0 } }
  .ad-burst { position:fixed; left:50%; top:45%; z-index:2100; pointer-events:none; font-size:30px; animation: adBurst 1s ease-out forwards; }
  @keyframes adBurst { to { transform: translate(var(--dx), var(--dy)) scale(.4); opacity:0; } }

  /* --- Harakatni kamaytirish --- */
  .ad-reduced .ad-radar::before, .ad-reduced .ad-radar::after, .ad-reduced .ad-hint { animation:none; }
  .ad-reduced .ad-person { animation:none; transition:none; }
  @media (prefers-reduced-motion: reduce) { .ad-radar::before, .ad-radar::after, .ad-hint { animation:none; } }
  `;
  document.head.appendChild(css);

  const H = { credentials: 'include' };
  const J = { 'Content-Type': 'application/json' };
  const REDUCED = typeof REDUCED_MOTION !== 'undefined' && REDUCED_MOTION;
  const LAUNCH_PX = 130, FULL_PX = 220;
  let S = null;   // AirDrop sessiyasi (sahifa ochiq paytda)

  async function post(path, body) {
    const r = await fetch(`${API_BASE}/api/airdrop/${path}`, { method: 'POST', ...H, headers: J, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await r.json(); } catch (e) { /* bo'sh javob */ }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Xatolik'), { data });
    return data;
  }

  // ---------- Tovush (fayllarsiz, WebAudio) ----------
  let actx = null;
  const soundOn = () => { try { return localStorage.getItem('ad_sound') !== '0'; } catch (e) { return true; } };
  function audio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
    return actx;
  }
  function whoosh() {
    if (!soundOn() || !audio()) return;
    try {
      const n = actx.sampleRate * 0.45, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(400, actx.currentTime); f.frequency.exponentialRampToValueAtTime(3200, actx.currentTime + 0.4);
      const g = actx.createGain(); g.gain.value = 0.35;
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
    } catch (e) { /* tovush ixtiyoriy */ }
  }
  function ding() {
    if (!soundOn() || !audio()) return;
    try {
      [880, 1320].forEach((hz, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
        o.type = 'sine'; o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.75);
      });
    } catch (e) { /* tovush ixtiyoriy */ }
  }

  // ---------- Nur (tepadan tushadi) ----------
  function light() {
    let el = document.getElementById('adLight');
    if (!el) { el = document.createElement('div'); el.id = 'adLight'; el.innerHTML = '<div class="top"></div><div class="rim"></div>'; document.body.appendChild(el); }
    return el;
  }
  function setLight(level, mode, slow) {
    const el = light();
    el.className = (mode || 'warm') + (slow ? ' slow' : '');
    el.style.setProperty('--lv', String(Math.max(0, Math.min(1, level))));
  }
  function killLight() { const el = document.getElementById('adLight'); if (el) el.remove(); }

  // ---------- Sahifa ----------
  window.openAirdropPage = async function () {
    stopAirdrop();
    audio();   // foydalanuvchi bosgan paytda tovushni "uyg'otib" qo'yamiz
    const me = (typeof currentUser !== 'undefined' && currentUser) || {};
    document.getElementById('modalBody').innerHTML = `
      <div class="ad-wrap ${REDUCED ? 'ad-reduced' : ''}" id="airdropRoot">
        <div class="ad-top">
          <button class="ad-chip" id="adChip" type="button">📶 GPS aniqlanmoqda...</button>
          <button class="ad-snd" id="adSnd" type="button" aria-label="Tovush">${soundOn() ? '🔊' : '🔇'}</button>
        </div>
        <div class="ad-tip" id="adTip"></div>
        <div class="ad-radar" id="adRadar">
          <div class="ad-ring" style="width:190px;height:190px"></div><div class="ad-ring" style="width:250px;height:250px"></div>
          <div class="ad-me">${stAvatar(me, 58)}<span>SIZ</span></div>
          <div class="ad-empty" id="adEmpty"><b>📡 Yaqin atrofda hech kim yo'q</b>Do'stingiz ham AirDrop sahifasini ochsin va yoningizda tursin</div>
        </div>
        <div class="section-title">Qaysi giftni tashlaymiz?</div>
        <div class="ad-gifts" id="adGifts"></div>
        <div class="ad-stage" id="adStage"></div>
      </div>`;
    openPage('AirDrop', null);

    S = { nearby: [], els: new Map(), slots: new Map(), target: null, gift: null, gifts: [], pos: null, accState: 'wait', sending: false,
      pendingId: null, pendingUser: null, es: null, watch: null, beat: null, guard: null, incoming: null, glowAt: 0, glowOff: null };
    document.getElementById('adChip').onclick = () => document.getElementById('adTip').classList.toggle('show');
    document.getElementById('adSnd').onclick = e => {
      const on = !soundOn(); try { localStorage.setItem('ad_sound', on ? '1' : '0'); } catch (x) { /* ruxsat yo'q */ }
      e.currentTarget.textContent = on ? '🔊' : '🔇'; if (on) { audio(); ding(); }
    };
    renderStage(); loadGifts(); startLocation(); startStream();
    // Sahifa yopilsa yoki boshqa sahifa ochilsa — ulanish va "ko'rinish" o'chadi
    S.guard = setInterval(() => {
      const ov = document.getElementById('modalOverlay');
      if (!document.getElementById('airdropRoot') || !ov || !ov.classList.contains('open') || ov.classList.contains('closing')) stopAirdrop();
    }, 700);
  };

  window.stopAirdrop = function () {
    if (!S) return;
    clearInterval(S.beat); clearInterval(S.guard); clearTimeout(S.glowOff);
    if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
    if (S.es) S.es.close();
    closeIncoming(); killLight();
    S = null;
  };

  // ---------- Giftlar ----------
  async function loadGifts() {
    let list = [];
    try { const r = await fetch(`${API_BASE}/api/inventory/gifts`, H); list = (await r.json()).filter(g => !g.trade_id); } catch (e) { /* tarmoq xatosi */ }
    if (!S) return;
    S.gifts = list;
    if (S.gift && !list.some(g => g.inventory_id === S.gift.inventory_id)) S.gift = null;
    const el = document.getElementById('adGifts'); if (!el) return;
    el.innerHTML = list.length ? list.map(g => `
      <button class="ad-gift" data-id="${g.inventory_id}" type="button"><div class="ad-orb">${giftImg(g)}</div><b>${esc(g.name)}</b></button>`).join('')
      : `<div class="ad-none"><span class="big">🎁</span>Tashlash uchun giftingiz yo'q<br><button class="btn" id="adShop" type="button">🛍️ Do'kondan gift olish</button></div>`;
    el.querySelectorAll('.ad-gift').forEach(b => b.onclick = () => { S.gift = S.gifts.find(g => String(g.inventory_id) === b.dataset.id); renderStage(); });
    const shop = document.getElementById('adShop');
    if (shop) shop.onclick = () => { closeModal(); const t = document.querySelector('[data-tab="shops"]'); if (t) t.click(); };
    renderStage();
  }

  // ---------- Joylashuv ----------
  const CHIP = {
    wait: ['', '📶 GPS aniqlanmoqda...', 'Telefoningiz joylashuvni aniqlayapti, bir necha soniya kuting.'],
    good: ['good', '📶 GPS: yaxshi', "Aniqlik yaxshi — yaqin atrofdagilar ko'rinadi."],
    mid:  ['mid',  "📶 GPS: o'rtacha", "Aniqlik o'rtacha. Ochiq joyda yoki deraza oldida yaxshiroq ishlaydi."],
    bad:  ['bad',  '📶 GPS: past', "Aniqlik past — hozir hech kim ko'rinmasligi mumkin. Tashqariga yoki deraza oldiga chiqing. Noutbukda GPS bo'lmagani uchun telefondan foydalaning."],
    deny: ['bad',  '📍 Ruxsat berilmadi', "Joylashuvga ruxsat yo'q. Brauzer sozlamalarida sayt uchun joylashuvni yoqing va sahifani qayta oching."],
    fail: ['bad',  "📍 Aniqlab bo'lmadi", "Joylashuvni aniqlab bo'lmadi. Internet va GPS yoniqligini tekshiring."],
  };
  function setChip(state, acc) {
    S.accState = state;
    const chip = document.getElementById('adChip'), tip = document.getElementById('adTip'); if (!chip) return;
    const c = CHIP[state];
    chip.className = 'ad-chip ' + c[0];
    chip.textContent = c[1] + (acc != null && /^(good|mid|bad)$/.test(state) ? ` (±${acc} m)` : '');
    tip.textContent = c[2];
  }

  function startLocation() {
    if (!navigator.geolocation) { setChip('fail'); return; }
    const push = () => { if (S && S.pos) post('location', S.pos).catch(() => {}); };
    S.watch = navigator.geolocation.watchPosition(p => {
      if (!S) return;
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      const a = Math.round(p.coords.accuracy);
      setChip(a <= 20 ? 'good' : a <= 50 ? 'mid' : 'bad', a);
      push();
    }, err => setChip(err.code === 1 ? 'deny' : 'fail'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    S.beat = setInterval(push, 8000);   // joylashuv o'zgarmasa ham "ko'rinib" turish uchun
  }

  // ---------- Real-time ----------
  function startStream() {
    const es = new EventSource(`${API_BASE}/api/airdrop/stream`, { withCredentials: true });
    S.es = es;
    es.addEventListener('ready', () => { if (S && S.pos) post('location', S.pos).catch(() => {}); });
    es.addEventListener('nearby', e => { if (!S) return; S.nearby = JSON.parse(e.data).users || []; syncPeople(); });
    es.addEventListener('glow', e => onGlow(JSON.parse(e.data)));
    es.addEventListener('incoming', e => showIncoming(JSON.parse(e.data)));
    es.addEventListener('cancelled', e => { if (S && S.incoming && S.incoming.id === JSON.parse(e.data).id) { closeIncoming(); showToast('AirDrop bekor qilindi'); } });
    es.addEventListener('result', e => onResult(JSON.parse(e.data)));
  }

  // Qabul qiluvchi tomonda: sizga gift tashlanayotganda ekran tepasidan sovuq nur tushadi
  function onGlow(d) {
    if (!S) return;
    clearTimeout(S.glowOff);
    setLight(d.level, 'cool');
    if (d.level > 0) S.glowOff = setTimeout(() => setLight(0, 'cool', true), 1500);   // oqim uzilsa ham nur so'nadi
  }

  // ---------- Radar: odamlar ----------
  function pickAngle() {   // mavjud odamlardan eng uzoq burchak
    const used = [...S.slots.values()].map(s => s.a);
    if (!used.length) return Math.random() * Math.PI * 2;
    let best = 0, bestD = -1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, dmin = Math.min(...used.map(u => { const x = Math.abs(a - u) % (Math.PI * 2); return Math.min(x, Math.PI * 2 - x); }));
      if (dmin > bestD) { bestD = dmin; best = a; }
    }
    return best;
  }

  function syncPeople() {
    const radar = document.getElementById('adRadar'); if (!radar || !S) return;
    const ids = new Set(S.nearby.map(u => u.id));
    for (const [id, el] of S.els) {     // ketganlar
      if (!ids.has(id)) { el.classList.add('leave'); setTimeout(() => el.remove(), 300); S.els.delete(id); S.slots.delete(id); if (S.target === id) S.target = null; }
    }
    for (const u of S.nearby) {          // kelganlar
      if (S.els.has(u.id)) continue;
      const ring = S.slots.size % 2 ? 118 : 92;
      const slot = { a: pickAngle(), r: ring }; S.slots.set(u.id, slot);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ad-person'; b.dataset.id = u.id;
      b.style.left = `calc(50% + ${Math.round(Math.cos(slot.a) * slot.r)}px)`; b.style.top = `calc(50% + ${Math.round(Math.sin(slot.a) * slot.r)}px)`;
      b.innerHTML = `${stAvatar(u, 52)}<span>${esc(u.full_name || u.username)}</span>`;
      b.onclick = () => { S.target = S.target === u.id ? null : u.id; paintSelection(); renderStage(); };
      radar.appendChild(b); S.els.set(u.id, b);
    }
    if (S.nearby.length === 1 && !S.target) S.target = S.nearby[0].id;   // bitta odam bo'lsa — avtomatik tanlanadi
    document.getElementById('adEmpty').classList.toggle('hide', S.nearby.length > 0);
    paintSelection(); renderStage();
  }

  function paintSelection() { for (const [id, el] of S.els) el.classList.toggle('sel', id === S.target); }
  const nameOf = id => { const u = S.nearby.find(x => x.id === id); return u ? (u.full_name || '@' + u.username) : ''; };

  // ---------- Tashlash (swipe up) ----------
  function renderStage() {
    const st = document.getElementById('adStage'); if (!st || !S) return;
    document.querySelectorAll('.ad-gift').forEach(b => b.classList.toggle('sel', !!S.gift && String(S.gift.inventory_id) === b.dataset.id));
    if (S.pendingId) {
      const u = S.pendingUser;
      st.innerHTML = `<div class="ad-wait"><div class="box"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle class="fg" cx="42" cy="42" r="36" style="animation-duration:30s"/></svg>${stAvatar(u, 56)}</div>
        <div>${esc(u ? (u.full_name || '@' + u.username) : '')} javobini kutyapmiz...</div><button class="btn secondary" id="adCancel" type="button">Bekor qilish</button></div>`;
      document.getElementById('adCancel').onclick = cancelPending; return;
    }
    if (!S.gift || !S.target) {
      st.innerHTML = `<div class="ad-hint" style="animation:none;opacity:.6">${!S.gift ? 'Avval giftni tanlang' : S.nearby.length ? 'Endi radardan odamni tanlang' : "Yaqin atrofda odam paydo bo'lishini kuting"}</div>`; return;
    }
    st.innerHTML = `<div class="ad-hint">⬆️ Qanchalik baland surilsa, shunchalik yorqin nur tushadi</div>
      <div class="ad-puck" id="adPuck">${giftImg(S.gift)}</div><div class="ad-to">Kimga: <b>${esc(nameOf(S.target))}</b></div>`;
    bindSwipe(document.getElementById('adPuck'));
  }

  function sendGlow(level, force) {
    if (!S || !S.target) return;
    const now = Date.now();
    if (!force && now - S.glowAt < 110) return;
    S.glowAt = now;
    post('glow', { to_user_id: S.target, level }).catch(() => {});
  }

  function bindSwipe(puck) {
    let y0 = null, dy = 0;
    puck.onpointerdown = e => { y0 = e.clientY; dy = 0; puck.setPointerCapture(e.pointerId); puck.classList.remove('back'); audio(); };
    puck.onpointermove = e => {
      if (y0 === null) return;
      dy = Math.min(0, e.clientY - y0);
      const lv = Math.min(1, -dy / FULL_PX);
      puck.style.transform = `translateY(${dy}px) scale(${1 + lv * 0.25}) rotate(${dy / 45}deg)`;
      setLight(lv, 'warm'); sendGlow(lv);     // yuboruvchida iliq nur, qabul qiluvchida sovuq nur
    };
    const end = () => {
      if (y0 === null) return; y0 = null;
      if (-dy >= LAUNCH_PX) launch(puck);
      else { puck.classList.add('back'); puck.style.transform = ''; setLight(0, 'warm', true); sendGlow(0, true); }
    };
    puck.onpointerup = end; puck.onpointercancel = end;
  }

  async function launch(puck) {
    if (S.sending) return; S.sending = true;
    const gift = S.gift, target = S.target, user = S.nearby.find(u => u.id === target);
    whoosh();
    puck.classList.add('fly'); puck.style.transform = 'translateY(-70vh) scale(.35) rotate(-14deg)';
    setLight(1, 'warm'); setTimeout(() => { if (S) setLight(0, 'warm', true); }, 700);
    try {
      const r = await post('send', { to_user_id: target, inventory_id: gift.inventory_id });   // PIN kerak bo'lsa, global fetch o'zi so'raydi
      if (!S) return;
      S.pendingId = r.id; S.pendingUser = user; S.gifts = S.gifts.filter(g => g !== gift); S.gift = null;
      loadGifts();
    } catch (e) {
      if (!S) return;
      puck.classList.remove('fly'); puck.classList.add('back'); puck.style.transform = ''; setLight(0, 'warm', true); sendGlow(0, true);
      showToast(e.message);
    } finally { if (S) S.sending = false; }
  }

  async function cancelPending() {
    if (!S || !S.pendingId) return;
    try { await post(`${S.pendingId}/cancel`); } catch (e) { showToast(e.message); }
    if (S) { S.pendingId = null; S.pendingUser = null; loadGifts(); }
  }

  function onResult(r) {
    if (!S || r.id !== S.pendingId) return;
    S.pendingId = null; S.pendingUser = null;
    const msg = { ACCEPTED: '✅ Gift qabul qilindi!', DECLINED: '❌ Rad etildi', EXPIRED: '⌛ Javob kelmadi, gift sizda qoldi', CANCELLED: 'Bekor qilindi' }[r.status] || r.status;
    showToast(msg);
    if (r.status === 'ACCEPTED') { ding(); burst(); }
    loadGifts();
  }

  // ---------- Qabul qiluvchi: gift tepadan tushadi ----------
  function showIncoming(d) {
    if (!S) return;
    closeIncoming();
    clearTimeout(S.glowOff); setLight(1, 'cool'); S.glowOff = setTimeout(() => setLight(0, 'cool', true), 1300);
    const secs = Math.max(3, Math.round((new Date(d.expires_at).getTime() - Date.now()) / 1000));
    const ov = document.createElement('div');
    ov.className = 'ad-incoming';
    ov.innerHTML = `
      <div class="ad-card">
        <div class="ad-fall">${giftImg(d.gift)}</div>
        <h3>${esc(d.gift.name)}</h3>
        <p>${esc(d.from.full_name || '@' + d.from.username)} sizga AirDrop yubordi</p>
        <div class="ad-row"><button class="btn secondary" id="adNo" type="button">Rad etish</button><button class="btn" id="adYes" type="button">Qabul qilish</button></div>
        <div class="ad-timer"><i style="animation-duration:${secs}s"></i></div>
      </div>`;
    document.body.appendChild(ov);
    S.incoming = { id: d.id, el: ov, timer: setTimeout(closeIncoming, secs * 1000) };
    ding();
    if (navigator.vibrate && !REDUCED) navigator.vibrate([40, 30, 80]);
    document.getElementById('adNo').onclick = async () => { try { await post(`${d.id}/decline`); } catch (e) { /* allaqachon yopilgan */ } closeIncoming(); };
    document.getElementById('adYes').onclick = async () => {
      try { await post(`${d.id}/accept`); showToast('🎁 Gift Inventoringizga tushdi!'); burst(); }
      catch (e) { showToast(e.message); }
      closeIncoming();
    };
  }

  function closeIncoming() {
    if (!S || !S.incoming) return;
    clearTimeout(S.incoming.timer); S.incoming.el.remove(); S.incoming = null;
  }

  function burst() {
    if (REDUCED) return;
    ['🎁', '✨', '🎉', '⭐', '✨', '🎁', '🎉', '✨'].forEach((ch, i) => {
      const s = document.createElement('div'); s.className = 'ad-burst'; s.textContent = ch;
      const a = (i / 8) * Math.PI * 2;
      s.style.setProperty('--dx', Math.cos(a) * 130 + 'px'); s.style.setProperty('--dy', Math.sin(a) * 130 + 'px');
      document.body.appendChild(s); setTimeout(() => s.remove(), 1000);
    });
  }
})();
