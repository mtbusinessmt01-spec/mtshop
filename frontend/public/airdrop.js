// AirDrop: yaqin foydalanuvchiga gift tashlash.
// index.html dagi global funksiyalarga tayanadi: openPage, closeModal, showToast, esc, stAvatar,
// giftImg, askPin, closePinPrompt, _origFetch, API_BASE, currentUser, REDUCED_MOTION.
// Shu faylni asosiy <script> dan KEYIN ulang.
(function () {
  const css = document.createElement('style');
  css.textContent = `
  /* --- Sahifa: to'liq ekranli radar --- */
  .modal-box:has(#airdropRoot) { padding:0 !important; overflow:hidden !important; }
  .modal-box:has(#airdropRoot) #modalBody { height:100%; }
  #airdropRoot { position:relative; height:100%; overflow:hidden; user-select:none; -webkit-user-select:none;
    background: radial-gradient(circle at 50% 44%, rgba(108,92,231,.34), transparent 64%); }
  .ad-radar { position:absolute; inset:0; }
  .ad-ring { position:absolute; border-radius:50%; border:2px solid rgba(255,255,255,.13); transform:translate(-50%,-50%); }
  .ad-ring.r1 { border-color:rgba(255,255,255,.22); }
  .ad-pulse { position:absolute; border-radius:50%; border:2px solid rgba(162,155,254,.55); transform:translate(-50%,-50%) scale(.4); animation: adPulse 3.2s ease-out infinite; }
  @keyframes adPulse { from { transform:translate(-50%,-50%) scale(.4); opacity:.9; } to { transform:translate(-50%,-50%) scale(2.5); opacity:0; } }
  .ad-me { position:absolute; transform:translate(-50%,-50%); z-index:2; }
  .ad-me .st-avatar { border-radius:50%; object-fit:cover; box-shadow:0 0 0 5px rgba(255,255,255,.2), 0 0 34px rgba(108,92,231,.75); }

  /* --- Tepada: GPS chipi va tovush --- */
  .ad-chiprow { position:absolute; left:14px; right:14px; top:calc(70px + env(safe-area-inset-top)); z-index:4; display:flex; align-items:center; gap:8px; }
  .ad-chip { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border-radius:999px; border:0; font:inherit; font-size:13px; font-weight:600; cursor:pointer; color:#fff; background:rgba(255,255,255,.12); }
  .ad-chip.good { background:rgba(46,204,113,.22); color:#58e39a; } .ad-chip.mid { background:rgba(245,165,36,.22); color:#ffc15a; } .ad-chip.bad { background:rgba(231,76,60,.22); color:#ff8a7d; }
  .ad-snd { margin-left:auto; width:36px; height:36px; border-radius:50%; border:0; background:rgba(255,255,255,.12); font-size:17px; cursor:pointer; color:inherit; }
  .ad-tip { position:absolute; left:14px; right:14px; top:calc(114px + env(safe-area-inset-top)); z-index:4; display:none; padding:10px 14px; border-radius:16px; font-size:13px; line-height:1.45;
    background:rgba(30,30,40,.92); }
  .ad-tip.show { display:block; }
  .ad-empty { position:absolute; left:0; right:0; top:calc(122px + env(safe-area-inset-top)); z-index:3; text-align:center; font-size:13px; line-height:1.45; opacity:.8; padding:0 28px; transition:opacity .3s; pointer-events:none; }
  .ad-empty b { display:block; font-size:15px; margin-bottom:2px; } .ad-empty.hide { opacity:0; }

  /* --- Radardagi odamlar --- */
  .ad-person { position:absolute; z-index:3; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:4px; width:74px; background:none; border:0; color:inherit; font:inherit; cursor:pointer;
    transition:left .6s ease, top .6s ease; animation: adPop .5s cubic-bezier(.2,1.6,.4,1) both; }
  .ad-person.leave { animation: adLeave .3s ease forwards; pointer-events:none; }
  @keyframes adPop { from { opacity:0; transform:translate(-50%,-50%) scale(0); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
  @keyframes adLeave { to { opacity:0; transform:translate(-50%,-50%) scale(.4); } }
  .ad-person .st-avatar { border-radius:50%; object-fit:cover; border:3px solid transparent; transition:border-color .2s, box-shadow .2s, transform .2s; }
  .ad-person.sel .st-avatar { border-color:#a29bfe; box-shadow:0 0 24px rgba(162,155,254,.95); transform:scale(1.14); }
  .ad-person span { font-size:11px; max-width:74px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.92; text-shadow:0 1px 4px rgba(0,0,0,.6); }

  /* --- Pastki "Gifts" tugmasi (tepaga tortiladi) --- */
  .ad-pill { position:absolute; left:16px; right:16px; bottom:calc(14px + env(safe-area-inset-bottom)); height:64px; z-index:6; border:0; border-radius:32px; color:#fff; font:inherit; font-size:20px; font-weight:700;
    display:flex; align-items:flex-end; justify-content:center; gap:8px; padding-bottom:13px; cursor:pointer; touch-action:none;
    background:rgba(255,255,255,.14); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
  .ad-pill::before { content:''; position:absolute; top:8px; left:50%; width:58px; height:5px; margin-left:-29px; border-radius:5px; background:rgba(255,255,255,.9); }
  .ad-pill small { font-size:13px; font-weight:600; opacity:.75; align-self:flex-end; padding-bottom:3px; }

  /* --- Tashlash joyi --- */
  .ad-dock { position:absolute; left:0; right:0; bottom:calc(92px + env(safe-area-inset-bottom)); z-index:5; display:flex; flex-direction:column; align-items:center; gap:8px; pointer-events:none; }
  .ad-dock > * { pointer-events:auto; }
  .ad-hint { font-size:13px; opacity:.8; text-align:center; padding:0 24px; }
  .ad-hint.bob { animation: adBob 1.6s ease-in-out infinite; }
  @keyframes adBob { 50% { transform:translateY(-6px); opacity:1; } }
  .ad-puck { width:104px; height:104px; border-radius:26px; overflow:hidden; cursor:grab; touch-action:none; will-change:transform; background:#2a2358;
    box-shadow:0 12px 34px rgba(108,92,231,.6), 0 0 0 4px rgba(255,255,255,.18); }
  .ad-puck.dim { opacity:.45; cursor:default; box-shadow:none; }
  .ad-puck img { width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
  .ad-puck .gift-img-fallback { font-size:56px; line-height:104px; text-align:center; pointer-events:none; }
  .ad-to { font-size:13px; opacity:.88; } .ad-to b { font-weight:700; }
  .ad-wait { display:flex; flex-direction:column; align-items:center; gap:8px; font-size:14px; text-align:center; }
  .ad-wait .box { position:relative; width:84px; height:84px; }
  .ad-wait .st-avatar { position:absolute; left:14px; top:14px; border-radius:50%; object-fit:cover; }
  .ad-wait svg { position:absolute; inset:0; transform:rotate(-90deg); }
  .ad-wait circle { fill:none; stroke-width:4; }
  .ad-wait .bg { stroke:rgba(255,255,255,.15); } .ad-wait .fg { stroke:#a29bfe; stroke-linecap:round; stroke-dasharray:226; stroke-dashoffset:0; animation: adCount linear forwards; }
  @keyframes adCount { to { stroke-dashoffset:226; } }

  /* --- Gift oynasi (pastdan tepaga tortiladi) --- */
  .ad-scrim { position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.3); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); opacity:0; pointer-events:none; transition:opacity .25s; }
  .ad-scrim.open { opacity:1; pointer-events:auto; }
  .ad-sheet { position:absolute; left:10px; right:10px; bottom:calc(10px + env(safe-area-inset-bottom)); height:56%; z-index:21; display:flex; flex-direction:column; padding:6px 16px 14px;
    border-radius:30px; color:#fff; background:rgba(62,62,72,.97); box-shadow:0 -10px 40px rgba(0,0,0,.35); transform:translateY(118%); transition:transform .38s cubic-bezier(.22,1,.36,1); }
  .ad-sheet.open { transform:none; }
  .ad-grab { padding:8px 0 12px; display:flex; justify-content:center; touch-action:none; cursor:grab; }
  .ad-grab i { width:58px; height:5px; border-radius:5px; background:rgba(255,255,255,.9); }
  .ad-sheet h3 { margin:0 0 12px 4px; font-size:23px; font-weight:800; }
  .ad-grid { flex:1; overflow-y:auto; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; align-content:start; padding:3px 3px 8px; -webkit-overflow-scrolling:touch; }
  .ad-gift { border:0; background:none; color:inherit; font:inherit; text-align:center; cursor:pointer; padding:0; transition:transform .2s; }
  .ad-gift.sel { transform:scale(1.05); }
  .ad-gift.sel .ad-thumb { box-shadow:0 0 0 3px #a29bfe, 0 8px 22px rgba(108,92,231,.55); }
  .ad-thumb { width:100%; aspect-ratio:1; border-radius:22px; overflow:hidden; background:rgba(255,255,255,.1); display:flex; align-items:center; justify-content:center; }
  .ad-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
  .ad-thumb .gift-img-fallback { font-size:38px; }
  .ad-gift b { display:block; margin-top:6px; font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ad-none { grid-column:1 / -1; text-align:center; padding:26px 10px 8px; font-size:14px; opacity:.92; }
  .ad-none .big { font-size:42px; display:block; margin-bottom:6px; } .ad-none .btn { margin-top:12px; }

  /* --- Nur: tepadan yumshoq tushadi (qattiq chiziqsiz) --- */
  #adLight { position:fixed; inset:0; z-index:1500; pointer-events:none; --lv:0; }
  #adLight .top { position:absolute; left:-10%; right:-10%; top:-30px; height:calc(var(--lv) * 80vh + 30px); opacity:calc(var(--lv) * 1.05); filter:blur(14px);
    transition:height .14s linear, opacity .14s linear; }
  #adLight .rim { position:absolute; inset:0; opacity:calc(var(--lv) * .9); transition:opacity .14s linear; }
  #adLight.warm .top { background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(255,170,70,.95), rgba(255,95,120,.45) 50%, transparent 80%); }
  #adLight.warm .rim { box-shadow: inset 0 0 110px 14px rgba(255,140,60,.5); }
  #adLight.cool .top { background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(90,175,255,.95), rgba(125,95,255,.45) 50%, transparent 80%); }
  #adLight.cool .rim { box-shadow: inset 0 0 110px 14px rgba(90,160,255,.5); }
  #adLight.slow .top, #adLight.slow .rim { transition-duration:.7s; }

  /* --- Qabul qiluvchi: gift tepadan tushadi --- */
  .ad-incoming { position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; background:rgba(8,6,20,.72);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: adFade .25s ease; }
  @keyframes adFade { from { opacity:0 } }
  .ad-card { width:min(320px, 88vw); text-align:center; padding:26px 20px 20px; border-radius:30px; color:#fff;
    background: linear-gradient(160deg, rgba(108,92,231,.92), rgba(40,30,110,.95)); box-shadow:0 20px 60px rgba(0,0,0,.5); position:relative; }
  .ad-fall { width:128px; height:128px; margin:-90px auto 10px; border-radius:30px; overflow:hidden; animation: adFall .9s cubic-bezier(.22,1.4,.4,1) both; box-shadow:0 14px 26px rgba(0,0,0,.4); background:#2a2358; }
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
  .ad-reduced .ad-pulse, .ad-reduced .ad-hint.bob { animation:none; }
  .ad-reduced .ad-person { animation:none; transition:none; }
  .ad-reduced .ad-sheet, .ad-reduced .ad-scrim { transition:none; }
  @media (prefers-reduced-motion: reduce) { .ad-pulse, .ad-hint.bob { animation:none; } }
  `;
  document.head.appendChild(css);

  const H = { credentials: 'include' };
  const J = { 'Content-Type': 'application/json' };
  const REDUCED = typeof REDUCED_MOTION !== 'undefined' && REDUCED_MOTION;
  const LAUNCH_PX = 90;          // shundan baland surib qo'yib yuborilsa — gift uchadi
  let S = null;                  // AirDrop sessiyasi (sahifa ochiq paytda)
  const $ = s => document.querySelector(s);

  async function post(path, body, extra) {
    const r = await fetch(`${API_BASE}/api/airdrop/${path}`, { method: 'POST', ...H, headers: { ...J, ...(extra || {}) }, body: JSON.stringify(body || {}) });
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
    document.getElementById('modalBody').innerHTML = `
      <div id="airdropRoot" class="${REDUCED ? 'ad-reduced' : ''}">
        <div class="ad-radar" id="adRadar">
          <div class="ad-ring r1" data-r="0"></div><div class="ad-ring" data-r="1"></div><div class="ad-ring" data-r="2"></div>
          <div class="ad-pulse" id="adPulse"></div>
          <div class="ad-me" id="adMe"></div>
        </div>
        <div class="ad-chiprow">
          <button class="ad-chip" id="adChip" type="button">📶 GPS aniqlanmoqda...</button>
          <button class="ad-snd" id="adSnd" type="button" aria-label="Tovush">${soundOn() ? '🔊' : '🔇'}</button>
        </div>
        <div class="ad-tip" id="adTip"></div>
        <div class="ad-empty" id="adEmpty"><b>📡 Yaqin atrofda hech kim yo'q</b>Do'stingiz ham AirDrop sahifasini ochsin va yoningizda tursin</div>
        <div class="ad-dock" id="adDock"></div>
        <button class="ad-pill" id="adPill" type="button">Gifts <small id="adCnt"></small></button>
        <div class="ad-scrim" id="adScrim"></div>
        <div class="ad-sheet" id="adSheet">
          <div class="ad-grab" id="adGrab"><i></i></div>
          <h3>Gifts</h3>
          <div class="ad-grid" id="adGrid"></div>
        </div>
      </div>`;
    openPage('AirDrop', null);

    S = { nearby: [], els: new Map(), slots: new Map(), geo: null, target: null, gift: null, gifts: [], pos: null, accState: 'wait', sending: false,
      armTimer: null, pendingId: null, pendingUser: null, es: null, watch: null, beat: null, guard: null, incoming: null, glowAt: 0, glowOff: null, onResize: null };
    $('#adChip').onclick = () => $('#adTip').classList.toggle('show');
    $('#adSnd').onclick = e => {
      const on = !soundOn(); try { localStorage.setItem('ad_sound', on ? '1' : '0'); } catch (x) { /* ruxsat yo'q */ }
      e.currentTarget.textContent = on ? '🔊' : '🔇'; if (on) { audio(); ding(); }
    };
    bindPill(); bindSheet();
    layout(); renderDock(); loadGifts(); startLocation(); startStream();
    S.onResize = () => layout(); window.addEventListener('resize', S.onResize);
    // Sahifa yopilsa yoki boshqa sahifa ochilsa — ulanish va "ko'rinish" o'chadi
    S.guard = setInterval(() => {
      const ov = document.getElementById('modalOverlay');
      if (!document.getElementById('airdropRoot') || !ov || !ov.classList.contains('open') || ov.classList.contains('closing')) stopAirdrop();
    }, 700);
  };

  window.stopAirdrop = function () {
    if (!S) return;
    clearInterval(S.beat); clearInterval(S.guard); clearTimeout(S.glowOff); clearTimeout(S.armTimer);
    if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
    if (S.es) S.es.close();
    if (S.onResize) window.removeEventListener('resize', S.onResize);
    closeIncoming(); killLight();
    S = null;
  };

  // ---------- Joylashuv va o'lchamlar ----------
  function layout() {
    const root = document.getElementById('airdropRoot'); if (!root || !S) return;
    const W = root.clientWidth || 360, Hh = root.clientHeight || 640, base = Math.min(W, 520);
    const cx = Math.round(W / 2), cy = Math.round(Hh * 0.44);
    const radii = [base * 0.2, base * 0.335, base * 0.47];
    S.geo = { W, H: Hh, cx, cy, radii };
    root.querySelectorAll('.ad-ring').forEach(r => { const d = Math.round(radii[+r.dataset.r] * 2); r.style.cssText = `width:${d}px;height:${d}px;left:${cx}px;top:${cy}px`; });
    const pulse = $('#adPulse'); if (pulse) { const d = Math.round(radii[0] * 2); pulse.style.cssText = `width:${d}px;height:${d}px;left:${cx}px;top:${cy}px`; }
    const me = $('#adMe'), u = (typeof currentUser !== 'undefined' && currentUser) || {}, av = Math.round(Math.max(60, base * 0.19));
    if (me) { me.style.cssText = `left:${cx}px;top:${cy}px`; if (me.dataset.sz !== String(av)) { me.innerHTML = stAvatar(u, av); me.dataset.sz = String(av); } }
    for (const [id, el] of S.els) placePerson(el, S.slots.get(id));
  }

  function placePerson(el, slot) {
    if (!el || !slot || !S.geo) return;
    const g = S.geo, r = g.radii[slot.ring];
    el.style.left = Math.round(g.cx + Math.cos(slot.a) * r) + 'px';
    el.style.top = Math.round(g.cy + Math.sin(slot.a) * r) + 'px';
  }

  function pickAngle() {   // mavjud odamlardan eng uzoq burchak (pastga — tashlash joyiga — juda yaqin emas)
    const used = [...S.slots.values()].map(s => s.a);
    let best = null, bestD = -1;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 - Math.PI;
      if (Math.sin(a) > 0.45) continue;
      const dmin = used.length ? Math.min(...used.map(u => { const x = Math.abs(a - u) % (Math.PI * 2); return Math.min(x, Math.PI * 2 - x); })) : 9;
      if (dmin > bestD) { bestD = dmin; best = a; }
    }
    return best === null ? -Math.PI / 2 : best;
  }

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
    const chip = $('#adChip'), tip = $('#adTip'); if (!chip) return;
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
  function syncPeople() {
    const radar = $('#adRadar'); if (!radar || !S) return;
    const ids = new Set(S.nearby.map(u => u.id));
    for (const [id, el] of S.els) {     // ketganlar
      if (!ids.has(id)) { el.classList.add('leave'); setTimeout(() => el.remove(), 300); S.els.delete(id); S.slots.delete(id); if (S.target === id) S.target = null; }
    }
    for (const u of S.nearby) {          // kelganlar
      if (S.els.has(u.id)) continue;
      const slot = { a: pickAngle(), ring: S.slots.size % 2 ? 2 : 1 }; S.slots.set(u.id, slot);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ad-person'; b.dataset.id = u.id;
      b.innerHTML = `${stAvatar(u, 54)}<span>${esc(u.full_name || u.username)}</span>`;
      b.onclick = () => { S.target = S.target === u.id ? null : u.id; paintSelection(); renderDock(); };
      radar.appendChild(b); S.els.set(u.id, b); placePerson(b, slot);
    }
    if (S.nearby.length === 1 && !S.target) S.target = S.nearby[0].id;   // bitta odam bo'lsa — avtomatik tanlanadi
    $('#adEmpty').classList.toggle('hide', S.nearby.length > 0);
    paintSelection(); renderDock();
  }

  function paintSelection() { for (const [id, el] of S.els) el.classList.toggle('sel', id === S.target); }
  const nameOf = id => { const u = S.nearby.find(x => x.id === id); return u ? (u.full_name || '@' + u.username) : ''; };

  // ---------- Giftlar oynasi (pastdan tortiladi) ----------
  async function loadGifts() {
    let list = [];
    try { const r = await fetch(`${API_BASE}/api/inventory/gifts`, H); list = (await r.json()).filter(g => !g.trade_id); } catch (e) { /* tarmoq xatosi */ }
    if (!S) return;
    S.gifts = list;
    if (S.gift && !list.some(g => g.inventory_id === S.gift.inventory_id)) S.gift = null;
    renderGrid(); renderDock();
  }

  function renderGrid() {
    const grid = $('#adGrid'), cnt = $('#adCnt'); if (!grid || !S) return;
    if (cnt) cnt.textContent = S.gifts.length ? `· ${S.gifts.length}` : '';
    grid.innerHTML = S.gifts.length ? S.gifts.map(g => `
      <button class="ad-gift ${S.gift && S.gift.inventory_id === g.inventory_id ? 'sel' : ''}" data-id="${g.inventory_id}" type="button"><div class="ad-thumb">${giftImg(g)}</div><b>${esc(g.name)}</b></button>`).join('')
      : `<div class="ad-none"><span class="big">🎁</span>Tashlash uchun giftingiz yo'q<br><button class="btn" id="adShop" type="button">🛍️ Do'kondan gift olish</button></div>`;
    grid.querySelectorAll('.ad-gift').forEach(b => b.onclick = () => selectGift(S.gifts.find(g => String(g.inventory_id) === b.dataset.id)));
    const shop = $('#adShop');
    if (shop) shop.onclick = () => { closeModal(); const t = document.querySelector('[data-tab="shops"]'); if (t) t.click(); };
  }

  function openSheet() { if (!S) return; renderGrid(); $('#adScrim').classList.add('open'); $('#adSheet').classList.add('open'); }
  function closeSheet() { $('#adScrim').classList.remove('open'); $('#adSheet').classList.remove('open'); }

  function bindPill() {
    const pill = $('#adPill'); let y0 = null;
    pill.onpointerdown = e => { y0 = e.clientY; try { pill.setPointerCapture(e.pointerId); } catch (x) { /* ixtiyoriy */ } };
    pill.onpointermove = e => { if (y0 !== null && y0 - e.clientY > 24) { y0 = null; openSheet(); } };   // tepaga torting
    pill.onpointerup = () => { if (y0 !== null) { y0 = null; openSheet(); } };                              // yoki bosing
    pill.onpointercancel = () => { y0 = null; };
  }

  function bindSheet() {
    $('#adScrim').onclick = closeSheet;
    const grab = $('#adGrab'), sheet = $('#adSheet'); let y0 = null;
    grab.onpointerdown = e => { y0 = e.clientY; sheet.style.transition = 'none'; try { grab.setPointerCapture(e.pointerId); } catch (x) { /* ixtiyoriy */ } };
    grab.onpointermove = e => { if (y0 !== null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; };
    const end = e => {
      if (y0 === null) return;
      const d = e.clientY - y0; y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
      if (d > 70) closeSheet();
    };
    grab.onpointerup = end; grab.onpointercancel = end;
  }

  // ---------- PIN: swipe'dan OLDIN so'raladi ----------
  // Giftni tanlaganda server PIN'ni tekshiradi va giftni qisqa muddatga "tasdiqlangan" qiladi (/airdrop/arm).
  // PIN brauzerda saqlanmaydi, yuborishda qayta so'ralmaydi.
  async function armGift(g) {
    const body = JSON.stringify({ inventory_id: g.inventory_id });
    if (typeof _origFetch !== 'function' || typeof askPin !== 'function') {   // zaxira: global qatlam PIN'ni o'zi so'raydi
      try { const r = await post('arm', { inventory_id: g.inventory_id }); armExpiry(r.expires_in); return true; } catch (e) { showToast(e.message); return false; }
    }
    let pin = null;
    for (;;) {
      const headers = { ...J }; if (pin) headers['X-Tx-Pin'] = pin;
      const r = await _origFetch(`${API_BASE}/api/airdrop/arm`, { method: 'POST', ...H, headers, body });
      pin = null;                                   // PIN'ni darrov unutamiz
      if (!S) { if (typeof closePinPrompt === 'function') closePinPrompt(); return false; }
      let d = {}; try { d = await r.json(); } catch (e) { /* bo'sh javob */ }
      if (r.ok) { closePinPrompt(); armExpiry(d.expires_in); return true; }
      if (r.status === 403 && d.pin_required) {
        pin = await askPin(d.pin_invalid ? d.error : '', !!d.pin_invalid);
        if (pin === null) { closePinPrompt(); return false; }
        continue;
      }
      closePinPrompt(); showToast(d.error || 'Xatolik'); return false;   // bloklangan, muzlatilgan, gift band va h.k.
    }
  }

  function armExpiry(sec) {   // server tasdig'i tugaganda gift tanlovi ham bekor bo'ladi
    clearTimeout(S.armTimer);
    S.armTimer = setTimeout(() => {
      if (!S || !S.gift) return;
      S.gift = null; renderGrid(); renderDock(); showToast('Xavfsizlik uchun tasdiq muddati tugadi — giftni qayta tanlang');
    }, Math.max(10, (sec || 180) - 5) * 1000);
  }

  async function selectGift(g) {
    if (!g || !S) return;
    closeSheet();
    S.gift = null; renderDock();
    if (!(await armGift(g)) || !S) return;      // PIN kiritilmasa gift tanlanmaydi
    S.gift = g; renderGrid(); renderDock();
  }

  // ---------- Tashlash joyi (swipe up) ----------
  function renderDock() {
    const dock = $('#adDock'); if (!dock || !S) return;
    if (S.pendingId) {
      const u = S.pendingUser;
      dock.innerHTML = `<div class="ad-wait"><div class="box"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle class="fg" cx="42" cy="42" r="36" style="animation-duration:30s"/></svg>${stAvatar(u, 56)}</div>
        <div>${esc(u ? (u.full_name || '@' + u.username) : '')} javobini kutyapmiz...</div><button class="btn secondary" id="adCancel" type="button">Bekor qilish</button></div>`;
      $('#adCancel').onclick = cancelPending; return;
    }
    if (!S.gift) {
      dock.innerHTML = `<div class="ad-hint">${S.nearby.length ? '👇 Gift tanlash uchun «Gifts» ni tepaga torting' : "Yaqin atrofda odam paydo bo'lishini kuting"}</div>`; return;
    }
    if (!S.target) {
      dock.innerHTML = `<div class="ad-hint">Radardan kimga tashlashni tanlang</div><div class="ad-puck dim">${giftImg(S.gift)}</div>`; return;
    }
    dock.innerHTML = `<div class="ad-hint bob">⬆️ Tepaga suring — qanchalik baland, shunchalik yorqin nur</div>
      <div class="ad-puck" id="adPuck">${giftImg(S.gift)}</div><div class="ad-to">Kimga: <b>${esc(nameOf(S.target))}</b></div>`;
    bindSwipe($('#adPuck'));
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
    const full = () => Math.max(260, (S.geo ? S.geo.H : 640) * 0.65);   // ekranning ~65% ga surilganda nur to'liq yonadi
    puck.onpointerdown = e => { y0 = e.clientY; dy = 0; puck.style.transition = 'none'; try { puck.setPointerCapture(e.pointerId); } catch (x) { /* ixtiyoriy */ } audio(); };
    puck.onpointermove = e => {
      if (y0 === null) return;
      dy = Math.min(0, e.clientY - y0);                 // istagancha tepaga surish mumkin
      const lv = Math.min(1, -dy / full());
      puck.style.transform = `translateY(${dy}px) scale(${1 + lv * 0.12})`;     // aylanmaydi, to'g'ri tepaga
      setLight(lv, 'warm'); sendGlow(lv);               // yuboruvchida iliq nur, qabul qiluvchida sovuq nur
    };
    const end = () => {
      if (y0 === null) return; y0 = null;
      if (-dy >= LAUNCH_PX) launch(puck, dy);
      else { puck.style.transition = 'transform .35s cubic-bezier(.3,1.6,.5,1)'; puck.style.transform = ''; setLight(0, 'warm', true); sendGlow(0, true); }
    };
    puck.onpointerup = end; puck.onpointercancel = end;
  }

  async function launch(puck, dy) {
    if (S.sending) return; S.sending = true;
    const gift = S.gift, target = S.target, user = S.nearby.find(u => u.id === target);
    whoosh();
    const away = puck.getBoundingClientRect().bottom + 60;      // ekran tepasidan butunlay chiqib ketguncha
    puck.style.transition = 'transform .6s cubic-bezier(.5,0,.9,.55)';
    puck.style.transform = `translateY(${dy - away}px) scale(1.12)`;   // faqat tepaga, aylanmasdan
    setLight(1, 'warm'); setTimeout(() => { if (S) setLight(0, 'warm', true); }, 700);
    try {
      const r = await post('send', { to_user_id: target, inventory_id: gift.inventory_id });
      if (!S) return;
      clearTimeout(S.armTimer);                                 // tasdiq faqat shu yuborish uchun edi
      S.pendingId = r.id; S.pendingUser = user; S.gifts = S.gifts.filter(g => g !== gift); S.gift = null;
      renderGrid(); renderDock(); loadGifts();
    } catch (e) {
      if (!S) return;
      puck.style.transition = 'transform .4s cubic-bezier(.3,1.4,.5,1)'; puck.style.transform = ''; setLight(0, 'warm', true); sendGlow(0, true);
      if (e.data && e.data.need_arm) { S.gift = null; renderGrid(); renderDock(); }   // giftni qayta tanlash kerak
      showToast(e.message);
    } finally { if (S) S.sending = false; }
  }

  async function cancelPending() {
    if (!S || !S.pendingId) return;
    try { await post(`${S.pendingId}/cancel`); } catch (e) { showToast(e.message); }
    if (S) { S.pendingId = null; S.pendingUser = null; renderDock(); loadGifts(); }
  }

  function onResult(r) {
    if (!S || r.id !== S.pendingId) return;
    S.pendingId = null; S.pendingUser = null;
    const msg = { ACCEPTED: '✅ Gift qabul qilindi!', DECLINED: '❌ Rad etildi', EXPIRED: '⌛ Javob kelmadi, gift sizda qoldi', CANCELLED: 'Bekor qilindi' }[r.status] || r.status;
    showToast(msg);
    if (r.status === 'ACCEPTED') { ding(); burst(); }
    renderDock(); loadGifts();
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
