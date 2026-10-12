// Profil: Ism Familiya va profil rasmi qoidalari (sof funksiyalar, DB'ga bog'liq emas).

const NAME_MIN = 2;
const NAME_MAX = 40;
const AVATAR_MAX_BYTES = 250 * 1024;   // mijoz rasmni 320x320 ga kichraytirib yuboradi (odatda 20-50 KB)

// Harflar (har qanday alifbo), belgilar (urg'u), apostrof (' ʻ ʼ ’ `), tire, nuqta va bo'shliq.
// Raqam, <, >, emoji va boshqa belgilarga ruxsat yo'q.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}'ʻʼ’`.\- ]*$/u;

// { ok: true, value: 'Ali Valiyev' | null }  (bo'sh matn — ismni o'chirish)  yoki  { ok: false, error }
function normalizeFullName(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { ok: false, error: "Ism noto'g'ri formatda" };
  }
  const s = String(raw == null ? '' : raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: true, value: null };

  const len = [...s].length;
  if (len < NAME_MIN) return { ok: false, error: `Ism kamida ${NAME_MIN} ta belgidan iborat bo'lishi kerak` };
  if (len > NAME_MAX) return { ok: false, error: `Ism ko'pi bilan ${NAME_MAX} ta belgi bo'lishi mumkin` };
  if (!NAME_RE.test(s)) return { ok: false, error: "Ismda faqat harflar, bo'shliq, apostrof, tire va nuqta bo'lishi mumkin" };
  if ((s.match(/\p{L}/gu) || []).length < 2) return { ok: false, error: 'Ismda kamida 2 ta harf bo\'lishi kerak' };
  if (s.split(' ').length > 5) return { ok: false, error: "Ism juda ko'p so'zdan iborat" };
  return { ok: true, value: s };
}

// Fayl turini mimetype'ga ishonmasdan, birinchi baytlariga qarab aniqlaydi
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { NAME_MIN, NAME_MAX, AVATAR_MAX_BYTES, normalizeFullName, sniffImage };
