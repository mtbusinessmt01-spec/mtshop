const db = require('./db');

// Event hali boshlanmagan bo'lsa true — uning gift/case'lari Shopda ko'rinmaydi va sotib olib bo'lmaydi.
// Event boshlangach (va tugagandan keyin ham) ular oddiy gift/case sifatida qoladi.
async function isEventItemLocked(eventId) {
  if (!eventId) return false;
  const e = await db.prepare('SELECT starts_at FROM events WHERE id = ?').get(eventId);
  if (!e) return false;
  return e.starts_at > new Date().toISOString();
}

// Event ID ni tozalash: '' / null -> null, mavjud bo'lmasa -> undefined (xato)
async function parseEventId(raw) {
  if (raw === undefined) return undefined; // o'zgartirilmagan
  if (raw === null || raw === '' || raw === 'null') return null;
  const id = parseInt(raw, 10);
  if (isNaN(id)) return undefined;
  const e = await db.prepare('SELECT id FROM events WHERE id = ?').get(id);
  return e ? id : undefined;
}

// Faqat event DAVOM ETAYOTGAN paytda lenta qaytaradi (boshlanmagan yoki tugagan bo'lsa null).
// `r` — gifts/cases qatori bo'lib, unga LEFT JOIN events dan event_name, event_ribbon_color,
// event_starts_at, event_ends_at maydonlari qo'shilgan bo'lishi kerak.
function eventRibbon(r, nowIso) {
  if (!r || !r.event_id || !r.event_name) return null;
  if (r.event_starts_at > nowIso || r.event_ends_at < nowIso) return null;
  return { name: r.event_name, color: r.event_ribbon_color || '#00b0f0' };
}

// '#rrggbb' bo'lmasa — undefined (o'zgartirilmagan/xato)
function parseRibbonColor(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(String(raw)) ? String(raw).toLowerCase() : undefined;
}

module.exports = { isEventItemLocked, parseEventId, eventRibbon, parseRibbonColor };
