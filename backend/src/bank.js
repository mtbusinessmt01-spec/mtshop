// MTshop <-> MTbank imzolangan aloqa (MTbank bilan bir xil algoritm).
// X-MT-Signature = HMAC-SHA256(MERCHANT_SECRET, `${timestamp}.${METHOD}.${path}.${body}`)
const crypto = require('crypto');

const SECRET = process.env.MERCHANT_SECRET || '';
const BANK_URL = (process.env.BANK_URL || '').replace(/\/+$/, '');
const MAX_SKEW_MS = 5 * 60 * 1000;

function configured() {
  return SECRET.length >= 32 && !!BANK_URL;
}

function sign(method, path, body, ts) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${ts}.${String(method).toUpperCase()}.${path}.${body || ''}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// MTbank yuborgan webhook so'rovini tekshiradi
function verifyIncoming(req) {
  if (SECRET.length < 32) return false;
  const ts = req.get('x-mt-timestamp');
  const sig = req.get('x-mt-signature');
  if (!ts || !sig || !/^\d{10,15}$/.test(ts)) return false;
  if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return false;
  const path = req.originalUrl.split('?')[0];
  const body = req.rawBody ? req.rawBody.toString('utf8') : '';
  return safeEqual(sig, sign(req.method, path, body, ts));
}

// MTbank'ga imzolangan so'rov yuboradi. Bepul tarifda MTbank uxlab yotgan bo'lishi mumkin,
// shuning uchun uzoq kutamiz va bir marta qayta urinamiz.
async function bankRequest(method, path, bodyObj) {
  if (!configured()) throw new Error('MTbank sozlanmagan (BANK_URL va MERCHANT_SECRET kerak)');
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ts = String(Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const r = await fetch(BANK_URL + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-MT-Timestamp': ts, 'X-MT-Signature': sign(method, path, body, ts) },
        body: body || undefined,
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status >= 500) { lastErr = new Error(`MTbank xatosi (${r.status})`); continue; }
      if (!r.ok) { const e = new Error(data.error || `MTbank rad etdi (${r.status})`); e.status = r.status; e.final = true; throw e; }
      return data;
    } catch (e) {
      if (e.final) throw e;
      lastErr = e.name === 'AbortError' ? new Error('MTbank javob bermadi') : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

module.exports = { configured, sign, verifyIncoming, bankRequest };
