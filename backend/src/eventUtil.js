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

module.exports = { isEventItemLocked, parseEventId };
