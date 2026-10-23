// AirDrop: yaqin foydalanuvchiga gift tashlash.
// index.html dagi global funksiyalarga tayanadi: openPage, closeModal, showToast, esc, stAvatar,
// giftImg, API_BASE, currentUser, REDUCED_MOTION. Shu faylni asosiy <script> dan KEYIN ulang.
(function () {
  const css = document.createElement('style');
  css.textContent = `
  .ad-wrap { padding: 4px 2px 24px; }
  .ad-status { display:flex; align-items:center; gap:8px; font-size:13px; opacity:.85; margin:6px 0 14px; }
  .ad-dot { width:9px; height:9px; border-radius:50%; background:#f5a524; flex:none; }
  .ad-dot.ok { background:#2ecc71; } .ad-dot.bad { background:#e74c3c; }
  .ad-radar { position:relative; min-height:190px; border-radius:22px; margin-bottom:14px; padding:16px 10px 12px;
    background: radial-gradient(circle at 50% 100%, rgba(108,92,231,.28), transparent 70%), var(--glass-bg, rgba(255,255,255,.06));
    border:1px solid var(--glass-border, rgba(255,255,255,.12)); overflow:hidden; }
  .ad-radar::before, .ad-radar::after { content:''; position:absolute; left:50%; bottom:-60px; width:200px; height:200px; margin-left:-100px;
    border-radius:50%; border:2px solid rgba(162,155,254,.5); animation: adPulse 2.6s ease-out infinite; }
  .ad-radar::after { animation-delay: 1.3s; }
  @keyframes adPulse { from { transform:scale(.3); opacity:.9; } to { transform:scale(2.4); opacity:0; } }
  .ad-people { position:relative; z-index:1; display:flex; flex-wrap:wrap; gap:14px; justify-content:center; }
  .ad-person { background:none; border:0; color:inherit; font:inherit; display:flex; flex-direction:column; align-items:center; gap:6px; width:84px; cursor:pointer; opacity:.8; transition:transform .2s, opacity .2s; }
  .ad-person .st-avatar { border:3px solid transparent; transition:border-color .2s, box-shadow .2s; }
  .ad-person.sel { opacity:1; transform:scale(1.08); }
  .ad-person.sel .st-avatar { border-color:var(--accent-2,#a29bfe); box-shadow:0 0 18px rgba(162,155,254,.8); }
  .ad-person span { font-size:12px; max-width:84px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ad-empty { position:relative; z-index:1; text-align:center; padding:46px 12px 40px; font-size:14px; opacity:.75; }
  .ad-gifts { display:flex; gap:10px; overflow-x:auto; padding:6px 2px 12px; scroll-snap-type:x proximity; }
  .ad-gift { flex:none; width:104px; scroll-snap-align:start; text-align:center; background:var(--glass-bg, rgba(255,255,255,.06));
    border:2px solid var(--glass-border, rgba(255,255,255,.12)); border-radius:16px; padding:10px 6px; cursor:pointer; color:inherit; font:inherit; }
  .ad-gift.sel { border-color:var(--accent-2,#a29bfe); }
  .ad-gift img, .ad-gift .gift-img-fallback { width:64px; height:64px; object-fit:contain; display:block; margin:0 auto 6px; font-size:40px; line-height:64px; }
  .ad-gift b { display:block; font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ad-stage { position:relative; height:150px; display:flex; align-items:flex-end; justify-content:center; touch-action:none; user-select:none; -webkit-user-select:none; }
  .ad-hint { position:absolute; top:0; left:0; right:0; text-align:center; font-size:13px; opacity:.7; animation: adBob 1.6s ease-in-out infinite; }
  @keyframes adBob { 50% { transform:translateY(-6px); opacity:1; } }
  .ad-puck { width:104px; height:104px; border-radius:26px; display:flex; align-items:center; justify-content:center; cursor:grab; touch-action:none;
    background: linear-gradient(135deg, var(--accent,#6c5ce7), var(--accent-dark,#4834d4)); box-shadow:0 10px 30px rgba(108,92,231,.55); will-change: transform; }
  .ad-puck img, .ad-puck .gift-img-fallback { width:70px; height:70px; object-fit:contain; font-size:46px; line-height:70px; pointer-events:none; }
  .ad-puck.fly { transition: transform .55s cubic-bezier(.2,.8,.2,1), opacity .55s ease-in; opacity:0; }
  .ad-puck.back { transition: transform .35s cubic-bezier(.3,1.6,.5,1); }
  .ad-pending { text-align:center; font-size:14px; padding:10px; }
  /* Qabul qiluvchi: gift tepadan tushadi */
  .ad-incoming { position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; background:rgba(8,6,20,.72);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: adFade .25s ease; }
  @keyframes adFade { from { opacity:0 } }
  .ad-card { width:min(320px, 88vw); text-align:center; padding:26px 20px 20px; border-radius:26px; color:#fff;
    background: linear-gradient(160deg, rgba(108,92,231,.92), rgba(40,30,110,.95)); box-shadow:0 20px 60px rgba(0,0,0,.5); position:relative; }
  .ad-fall { width:128px; height:128px; margin:-90px auto 10px; animation: adFall .9s cubic-bezier(.22,1.4,.4,1) both; filter: drop-shadow(0 12px 18px rgba(0,0,0,.45)); }
  .ad-fall img, .ad-fall .gift-img-fallback { width:100%; height:100%; object-fit:contain; font-size:90px; line-height:128px; }
  @keyframes adFall { 0% { transform: translateY(-110vh) rotate(-18deg) scale(.6); } 70% { transform: translateY(8px) rotate(4deg) scale(1.05); } 100% { transform: none; } }
  .ad-card h3 { margin:6px 0 2px; font-size:20px; } .ad-card p { margin:0 0 14px; opacity:.85; font-size:14px; }
  .ad-row { display:flex; gap:10px; } .ad-row .btn { margin:0; flex:1; }
  .ad-timer { height:4px; border-radius:4px; background:rgba(255,255,255,.2); margin-top:14px; overflow:hidden; }
  .ad-timer i { display:block; height:100%; background:#fff; animation: adTimer linear forwards; }
  @keyframes adTimer { from { width:100% } to { width:0 } }
  .ad-burst { position:fixed; left:50%; top:45%; z-index:2100; pointer-events:none; font-size:30px; animation: adBurst 1s ease-out forwards; }
  @keyframes adBurst { to { transform: translate(var(--dx), var(--dy)) scale(.4); opacity:0; } }
  `;
  document.head.appendChild(css);

  const H = { credentials: 'include' };
  const J = { 'Content-Type': 'application/json' };
  let S = null;   // AirDrop sessiyasi (sahifa ochiq paytda)

  async function post(path, body) {
    const r = await fetch(`${API_BASE}/api/airdrop/${path}`, { method: 'POST', ...H, headers: J, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await r.json(); } catch (e) { /* bo'sh javob */ }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Xatolik'), { data });
    return data;
  }

  window.openAirdropPage = async function () {
    stopAirdrop();
    document.getElementById('modalBody').innerHTML = `
      <div class="ad-wrap" id="airdropRoot">
        <div class="ad-status"><span class="ad-dot" id="adDot"></span><span id="adStatus">Joylashuv aniqlanmoqda...</span></div>
        <div class="ad-radar"><div id="adPeople"><div class="ad-empty">Yaqin atrofda hech kim yo'q.<br>Do'stingiz ham AirDrop sahifasini ochsin.</div></div></div>
        <div class="section-title">Qaysi giftni tashlaymiz?</div>
        <div class="ad-gifts" id="adGifts"><div class="empty-msg">Yuklanmoqda...</div></div>
        <div class="ad-stage" id="adStage"></div>
      </div>`;
    openPage('AirDrop', typeof openJonatmoqBack === 'function' ? openJonatmoqBack : null);

    S = { nearby: [], target: null, gift: null, gifts: [], pos: null, sending: false, pendingId: null, es: null, watch: null, beat: null, guard: null, incoming: null };
    loadGifts();
    startLocation();
    startStream();
    S.guard = setInterval(() => { if (!document.getElementById('airdropRoot')) stopAirdrop(); }, 1000);   // sahifa yopilsa — to'xtaydi
  };

  window.stopAirdrop = function () {
    if (!S) return;
    clearInterval(S.beat); clearInterval(S.guard);
    if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
    if (S.es) S.es.close();
    closeIncoming();
    S = null;
  };

  async function loadGifts() {
    const r = await fetch(`${API_BASE}/api/inventory/gifts`, H);
    const list = (await r.json()).filter(g => !g.trade_id);
    if (!S) return;
    S.gifts = list;
    const el = document.getElementById('adGifts'); if (!el) return;
    el.innerHTML = list.length ? list.map(g => `
      <button class="ad-gift" data-id="${g.inventory_id}" type="button">${giftImg(g)}<b>${esc(g.name)}</b></button>`).join('')
      : `<div class="empty-msg">Sizda gift yo'q</div>`;
    el.querySelectorAll('.ad-gift').forEach(b => b.onclick = () => { S.gift = S.gifts.find(g => String(g.inventory_id) === b.dataset.id); renderStage(); });
  }

  // ---------- Joylashuv ----------
  function setStatus(text, cls) {
    const d = document.getElementById('adDot'), t = document.getElementById('adStatus');
    if (d) d.className = 'ad-dot ' + (cls || ''); if (t) t.textContent = text;
  }

  function startLocation() {
    if (!navigator.geolocation) { setStatus("Brauzer joylashuvni qo'llamaydi", 'bad'); return; }
    const push = () => {
      if (!S || !S.pos) return;
      post('location', S.pos).catch(e => { if (e.message && !/Avval AirDrop/.test(e.message)) console.warn(e.message); });
    };
    S.watch = navigator.geolocation.watchPosition(p => {
      if (!S) return;
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      const acc = Math.round(p.coords.accuracy);
      setStatus(acc <= 50 ? `Joylashuv tayyor (±${acc} m)` : `GPS aniqligi past (±${acc} m) — ochiq joyga chiqing`, acc <= 50 ? 'ok' : '');
      push();
    }, err => {
      setStatus(err.code === 1 ? "Joylashuvga ruxsat berilmadi — brauzer sozlamasidan yoqing" : "Joylashuvni aniqlab bo'lmadi", 'bad');
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    S.beat = setInterval(push, 8000);   // joylashuv o'zgarmasa ham "ko'rinib" turish uchun
  }

  // ---------- Real-time ----------
  function startStream() {
    const es = new EventSource(`${API_BASE}/api/airdrop/stream`, { withCredentials: true });
    S.es = es;
    es.addEventListener('ready', () => { if (S && S.pos) post('location', S.pos).catch(() => {}); });
    es.addEventListener('nearby', e => { if (!S) return; S.nearby = JSON.parse(e.data).users || []; if (S.target && !S.nearby.some(u => u.id === S.target)) S.target = null; renderPeople(); });
    es.addEventListener('incoming', e => showIncoming(JSON.parse(e.data)));
    es.addEventListener('cancelled', e => { if (S && S.incoming && S.incoming.id === JSON.parse(e.data).id) { closeIncoming(); showToast('AirDrop bekor qilindi'); } });
    es.addEventListener('result', e => onResult(JSON.parse(e.data)));
  }

  function renderPeople() {
    const el = document.getElementById('adPeople'); if (!el || !S) return;
    if (S.nearby.length === 1 && !S.target) S.target = S.nearby[0].id;   // bitta odam bo'lsa — avtomatik tanlanadi
    el.innerHTML = S.nearby.length
      ? `<div class="ad-people">${S.nearby.map(u => `
          <button class="ad-person ${u.id === S.target ? 'sel' : ''}" data-id="${u.id}" type="button">${stAvatar(u, 64)}<span>${esc(u.full_name || u.username)}</span></button>`).join('')}</div>`
      : `<div class="ad-empty">Yaqin atrofda hech kim yo'q.<br>Do'stingiz ham AirDrop sahifasini ochsin.</div>`;
    el.querySelectorAll('.ad-person').forEach(b => b.onclick = () => { S.target = Number(b.dataset.id); renderPeople(); renderStage(); });
    renderStage();
  }

  // ---------- Tashlash (swipe up) ----------
  function renderStage() {
    const st = document.getElementById('adStage'); if (!st || !S) return;
    document.querySelectorAll('.ad-gift').forEach(b => b.classList.toggle('sel', S.gift && String(S.gift.inventory_id) === b.dataset.id));
    if (S.pendingId) { st.innerHTML = `<div class="ad-pending">⏳ Javob kutilmoqda...<br><button class="btn secondary" style="margin-top:10px" id="adCancel">Bekor qilish</button></div>`; document.getElementById('adCancel').onclick = cancelPending; return; }
    if (!S.gift || !S.target) {
      st.innerHTML = `<div class="ad-pending" style="opacity:.7">${!S.gift ? 'Gift tanlang' : 'Yaqindagi odamni tanlang'}</div>`; return;
    }
    st.innerHTML = `<div class="ad-hint">⬆️ Tepaga surib tashlang</div><div class="ad-puck" id="adPuck">${giftImg(S.gift)}</div>`;
    bindSwipe(document.getElementById('adPuck'));
  }

  function bindSwipe(puck) {
    let y0 = null, dy = 0;
    puck.onpointerdown = e => { y0 = e.clientY; dy = 0; puck.setPointerCapture(e.pointerId); puck.classList.remove('back'); };
    puck.onpointermove = e => {
      if (y0 === null) return;
      dy = Math.min(0, e.clientY - y0);
      puck.style.transform = `translateY(${dy}px) scale(${1 + Math.min(.25, -dy / 600)}) rotate(${dy / 40}deg)`;
    };
    const end = () => {
      if (y0 === null) return; y0 = null;
      if (dy < -90) launch(puck); else { puck.classList.add('back'); puck.style.transform = ''; }
    };
    puck.onpointerup = end; puck.onpointercancel = end;
  }

  async function launch(puck) {
    if (S.sending) return; S.sending = true;
    const gift = S.gift, target = S.target;
    puck.classList.add('fly'); puck.style.transform = 'translateY(-70vh) scale(.35) rotate(-14deg)';
    try {
      const r = await post('send', { to_user_id: target, inventory_id: gift.inventory_id });   // PIN kerak bo'lsa, global fetch o'zi so'raydi
      if (!S) return;
      S.pendingId = r.id; S.gifts = S.gifts.filter(g => g !== gift); S.gift = null;
      loadGifts(); renderStage();
    } catch (e) {
      if (!S) return;
      puck.classList.remove('fly'); puck.classList.add('back'); puck.style.transform = '';
      showToast(e.message);
    } finally { if (S) S.sending = false; }
  }

  async function cancelPending() {
    if (!S || !S.pendingId) return;
    try { await post(`${S.pendingId}/cancel`); } catch (e) { showToast(e.message); }
    if (S) { S.pendingId = null; loadGifts(); renderStage(); }
  }

  function onResult(r) {
    if (!S || r.id !== S.pendingId) return;
    S.pendingId = null;
    const msg = { ACCEPTED: '✅ Gift qabul qilindi!', DECLINED: '❌ Rad etildi', EXPIRED: '⌛ Javob kelmadi, gift sizda qoldi', CANCELLED: 'Bekor qilindi' }[r.status] || r.status;
    showToast(msg);
    if (r.status === 'ACCEPTED') burst(); else loadGifts();
    renderStage();
  }

  // ---------- Qabul qiluvchi: gift tepadan tushadi ----------
  function showIncoming(d) {
    if (!S) return;
    closeIncoming();
    const secs = Math.max(3, Math.round((new Date(d.expires_at).getTime() - Date.now()) / 1000));
    const ov = document.createElement('div');
    ov.className = 'ad-incoming';
    ov.innerHTML = `
      <div class="ad-card">
        <div class="ad-fall">${giftImg(d.gift)}</div>
        <h3>${esc(d.gift.name)}</h3>
        <p>${esc(d.from.full_name || '@' + d.from.username)} sizga AirDrop yubordi</p>
        <div class="ad-row"><button class="btn secondary" id="adNo">Rad etish</button><button class="btn" id="adYes">Qabul qilish</button></div>
        <div class="ad-timer"><i style="animation-duration:${secs}s"></i></div>
      </div>`;
    document.body.appendChild(ov);
    S.incoming = { id: d.id, el: ov, timer: setTimeout(closeIncoming, secs * 1000) };
    if (navigator.vibrate && !REDUCED_MOTION) navigator.vibrate([40, 30, 80]);
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
    if (REDUCED_MOTION) return;
    ['🎁', '✨', '🎉', '⭐', '✨', '🎁', '🎉', '✨'].forEach((ch, i) => {
      const s = document.createElement('div'); s.className = 'ad-burst'; s.textContent = ch;
      const a = (i / 8) * Math.PI * 2;
      s.style.setProperty('--dx', Math.cos(a) * 130 + 'px'); s.style.setProperty('--dy', Math.sin(a) * 130 + 'px');
      document.body.appendChild(s); setTimeout(() => s.remove(), 1000);
    });
  }
})();
