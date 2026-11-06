/* ==========================================================================
   MTshop × Glisse — Liquid Glass (vanilla JS)
   1) Refraksiya filtrlari (SVG feDisplacementMap) — faqat Chromium'da
   2) Pastki menyu / Shops almashtirgich: bosganda "linza", barmoq bilan surish
   3) Tugmalar: barmoq ostidagi yorug'lik
   4) Slider: shisha tutqichli (.pz-range ni o'rab oladi)
   Hech narsa buzilmasligi uchun hammasi try/catch ichida.
   O'chirish: localStorage.setItem('mt-glisse','off') va sahifani yangilang.
   ========================================================================== */
(function () {
  'use strict';
  try {
    var doc = document, root = doc.documentElement;
    var ua = navigator.userAgent || '';
    var off = false;
    try { off = localStorage.getItem('mt-glisse') === 'off'; } catch (e) {}
    if (off) return;

    /* Refraksiya faqat Chromium'da (Chrome, Edge, Android Chrome, Samsung). iPhone/Safari/Firefox'da oddiy shisha. */
    var refract = /Chrome\/|Chromium\//.test(ua) && !/CriOS|EdgiOS|FxiOS|OPiOS/.test(ua) &&
      (navigator.hardwareConcurrency || 4) > 2;
    if (refract) root.classList.add('gl-refract');

    var NS = 'http://www.w3.org/2000/svg';
    var svg = null, defs = null;

    function ensureSvg() {
      if (svg) return true;
      if (!doc.body) return false;
      svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;overflow:hidden';
      defs = doc.createElementNS(NS, 'defs');
      svg.appendChild(defs);
      doc.body.appendChild(svg);
      return true;
    }

    /* ---------- Displacement xaritasi: qirralarda egilish ---------- */
    function makeMap(w, h, r, bezel) {
      var c = doc.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var img = ctx.createImageData(w, h), d = img.data;
      var hw = w / 2, hh = h / 2, ix = hw - r, iy = hh - r;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var px = x + 0.5 - hw, py = y + 0.5 - hh;
          var qx = Math.abs(px) - ix, qy = Math.abs(py) - iy;
          var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
          var out = Math.sqrt(ox * ox + oy * oy);
          var inside = Math.min(Math.max(qx, qy), 0);
          var depth = -(out + inside - r);          // chetdan ichkariga masofa
          var dx = 0, dy = 0;
          if (depth >= 0 && depth < bezel) {
            var t = 1 - depth / bezel;               // chetda 1, ichkarida 0
            var m = t * t;
            var nx, ny;
            if (out > 0) { nx = (px < 0 ? -1 : 1) * ox / out; ny = (py < 0 ? -1 : 1) * oy / out; }
            else if (qx > qy) { nx = px < 0 ? -1 : 1; ny = 0; }
            else { nx = 0; ny = py < 0 ? -1 : 1; }
            dx = -nx * m; dy = -ny * m;              // ichkariga qarab namuna olinadi
          }
          var i = (y * w + x) * 4;
          d[i] = 128 + dx * 127;
          d[i + 1] = 128 + dy * 127;
          d[i + 2] = 128;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    }

    function setFilter(id, w, h, r, bezel, shift) {
      if (!refract || !ensureSvg()) return false;
      w = Math.round(w); h = Math.round(h);
      if (w < 8 || h < 8) return false;
      r = Math.min(Math.round(r), Math.floor(Math.min(w, h) / 2));
      var key = [w, h, r, bezel, shift].join('x');
      var f = doc.getElementById(id);
      if (f && f.getAttribute('data-k') === key) return true;
      if (f) f.parentNode.removeChild(f);
      var map = makeMap(w, h, r, bezel), s = shift * 2;
      function chan(sc, vals, res) {
        return '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + sc.toFixed(1) +
          '" xChannelSelector="R" yChannelSelector="G" result="d' + res + '"/>' +
          '<feColorMatrix in="d' + res + '" type="matrix" values="' + vals + '" result="c' + res + '"/>';
      }
      f = doc.createElementNS(NS, 'filter');
      f.setAttribute('id', id);
      f.setAttribute('data-k', key);
      f.setAttribute('color-interpolation-filters', 'sRGB');
      f.innerHTML =
        '<feImage href="' + map + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="map"/>' +
        chan(s, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'R') +
        chan(s * 0.94, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'G') +
        chan(s * 0.88, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'B') +
        '<feBlend in="cR" in2="cG" mode="screen" result="rg"/>' +
        '<feBlend in="rg" in2="cB" mode="screen"/>';
      defs.appendChild(f);
      return true;
    }

    function setVar(name, val) { root.style.setProperty(name, val); }

    var K = 'var(--blur-k, 1)';
    function build() {
      if (!refract) return;
      try {
        if (setFilter('glf-thumb', 38, 28, 14, 12, 10)) {
          setVar('--gl-f-thumb', 'url(#glf-thumb) blur(calc(1px * ' + K + ')) saturate(170%)');
        }
        var nav = doc.getElementById('bottomNav');
        if (nav && nav.offsetWidth > 0) {
          if (setFilter('glf-nav', nav.offsetWidth, nav.offsetHeight, nav.offsetHeight / 2, 18, 11)) {
            setVar('--gl-f-nav', 'url(#glf-nav) blur(calc(12px * ' + K + ')) saturate(170%)');
          }
          var ind = nav.querySelector('.nav-liquid-indicator');
          if (ind && ind.offsetWidth > 0 &&
            setFilter('glf-ind', ind.offsetWidth, ind.offsetHeight, ind.offsetHeight / 2, Math.min(22, ind.offsetHeight / 2), 14)) {
            setVar('--gl-f-ind', 'url(#glf-ind) blur(calc(2px * ' + K + ')) saturate(180%)');
          }
        }
        var ss = doc.querySelector('.shop-switch');
        if (ss && ss.offsetWidth > 0) {
          if (setFilter('glf-segbar', ss.offsetWidth, ss.offsetHeight, ss.offsetHeight / 2, 14, 9)) {
            setVar('--gl-f-seg-bar', 'url(#glf-segbar) blur(calc(12px * ' + K + ')) saturate(170%)');
          }
          var si = ss.querySelector('.ss-ind');
          if (si && si.offsetWidth > 0 &&
            setFilter('glf-seg', si.offsetWidth, si.offsetHeight, si.offsetHeight / 2, Math.min(16, si.offsetHeight / 2), 10)) {
            setVar('--gl-f-seg', 'url(#glf-seg) blur(calc(2px * ' + K + ')) saturate(180%)');
          }
        }
      } catch (e) { /* refraksiya ishlamasa, oddiy shisha qoladi */ }
    }

    var buildQueued = false;
    function queueBuild() {
      if (buildQueued) return;
      buildQueued = true;
      requestAnimationFrame(function () { buildQueued = false; build(); });
    }

    /* ---------- Menyu: bosganda linza, surib tanlash ---------- */
    function initPress(el, draggable) {
      if (!el || el._glPress) return;
      el._glPress = true;
      var down = false, dragging = false, startX = 0, suppress = false;

      el.addEventListener('pointerdown', function (e) {
        if (e.button > 0) return;
        down = true; dragging = false; startX = e.clientX;
        el.classList.add('gl-pressed');
      });

      window.addEventListener('pointermove', function (e) {
        if (!down || !draggable) return;
        if (!dragging && Math.abs(e.clientX - startX) > 8) {
          dragging = true;
          el.classList.add('gl-dragging');
        }
        if (dragging) {
          var ind = el.querySelector('.nav-liquid-indicator');
          if (!ind) return;
          var r = el.getBoundingClientRect(), w = ind.offsetWidth;
          var x = e.clientX - r.left - w / 2;
          x = Math.max(5, Math.min(r.width - 5 - w, x));
          ind.style.left = x + 'px';
        }
      });

      function end(e) {
        if (!down) return;
        down = false;
        el.classList.remove('gl-pressed');
        if (dragging) {
          dragging = false;
          el.classList.remove('gl-dragging');
          suppress = true;
          setTimeout(function () { suppress = false; }, 80);
          var btns = el.querySelectorAll('button'), best = null, bd = 1e9;
          for (var i = 0; i < btns.length; i++) {
            var b = btns[i].getBoundingClientRect();
            var dd = Math.abs((b.left + b.width / 2) - e.clientX);
            if (dd < bd) { bd = dd; best = btns[i]; }
          }
          if (best) best.click();
        }
      }
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);

      // Surishdan keyin brauzer yuboradigan qo'shimcha "click" ni to'xtatamiz
      el.addEventListener('click', function (e) {
        if (suppress) { e.stopPropagation(); e.preventDefault(); }
      }, true);
    }

    /* ---------- Tugmalar: barmoq ostida yorug'lik ---------- */
    var activeBtn = null;
    function btnLight(e) {
      var b = e.target && e.target.closest ? e.target.closest('.btn') : null;
      if (!b || b.disabled) return;
      var r = b.getBoundingClientRect();
      b.style.setProperty('--gx', (e.clientX - r.left) + 'px');
      b.style.setProperty('--gy', (e.clientY - r.top) + 'px');
      activeBtn = b;
    }
    doc.addEventListener('pointerdown', btnLight, true);
    doc.addEventListener('pointermove', function (e) { if (activeBtn) btnLight(e); }, true);
    function btnRelease() {
      if (!activeBtn) return;
      activeBtn.style.removeProperty('--gx');
      activeBtn.style.removeProperty('--gy');
      activeBtn = null;
    }
    window.addEventListener('pointerup', btnRelease);
    window.addEventListener('pointercancel', btnRelease);

    /* ---------- Slider: shisha tutqich ---------- */
    var valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    var downRanges = [];
    function enhanceRange(inp) {
      if (inp.getAttribute('data-gl')) return;
      inp.setAttribute('data-gl', '1');
      var wrap = doc.createElement('span');
      wrap.className = 'gl-range';
      var track = doc.createElement('span'); track.className = 'gl-track';
      var fill = doc.createElement('span'); fill.className = 'gl-fill';
      track.appendChild(fill);
      var knob = doc.createElement('span'); knob.className = 'gl-knob';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(track); wrap.appendChild(knob); wrap.appendChild(inp);

      function sync() {
        var min = parseFloat(inp.min); if (isNaN(min)) min = 0;
        var max = parseFloat(inp.max); if (isNaN(max)) max = 100;
        var v = (parseFloat(inp.value) - min) / ((max - min) || 1);
        wrap.style.setProperty('--v', String(Math.max(0, Math.min(1, isNaN(v) ? 0 : v))));
      }
      inp.addEventListener('input', sync);
      inp.addEventListener('change', sync);
      try {   // kod value'ni o'zi o'zgartirsa ham tutqich joyida turadi
        Object.defineProperty(inp, 'value', {
          configurable: true,
          get: function () { return valueDesc.get.call(this); },
          set: function (v) { valueDesc.set.call(this, v); sync(); }
        });
      } catch (e) {}
      inp.addEventListener('pointerdown', function () { wrap.classList.add('gl-down'); downRanges.push(wrap); });
      sync();
    }
    function releaseRanges() {
      while (downRanges.length) downRanges.pop().classList.remove('gl-down');
    }
    window.addEventListener('pointerup', releaseRanges);
    window.addEventListener('pointercancel', releaseRanges);
    window.addEventListener('blur', releaseRanges);

    /* ---------- Yangi elementlarni topish ---------- */
    var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(queueBuild) : null;
    function watch(el) { if (ro && el && !el._glWatched) { el._glWatched = true; ro.observe(el); } }

    function scan() {
      var nav = doc.getElementById('bottomNav');
      if (nav) {
        initPress(nav, true);
        watch(nav);
        watch(nav.querySelector('.nav-liquid-indicator'));
      }
      var ss = doc.querySelector('.shop-switch');
      if (ss) {
        initPress(ss, false);
        watch(ss);
        watch(ss.querySelector('.ss-ind'));
      }
      var ranges = doc.querySelectorAll('input.pz-range:not([data-gl])');
      for (var i = 0; i < ranges.length; i++) enhanceRange(ranges[i]);
    }

    var scanQueued = false;
    function queueScan() {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(function () { scanQueued = false; scan(); });
    }

    function start() {
      scan();
      build();
      new MutationObserver(queueScan).observe(doc.body, { childList: true, subtree: true });
      window.addEventListener('resize', queueBuild);
      window.MTGlisse = { refraction: refract, rebuild: build };
    }
    if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);
  } catch (err) {
    if (window.console) console.warn('Glisse o\'chirildi:', err);
  }
})();
