const express = require('express');

const security = require('../security');
const biometric = require('../biometric');
const { authMiddleware } = require('../auth');

const router = express.Router();

const MAX_FREEZE_HOURS = 24 * 30;

// Parol noto'g'ri bo'lsa bir xil javob (pin_required belgisi YO'Q — frontend PIN so'ramasligi uchun)
function passwordFailure(res, pw) {
  if (pw.locked) {
    return res.status(429).json({
      error: `Parol ko'p marta xato kiritildi. ${Math.ceil(pw.retryAfterSec / 60)} daqiqadan keyin urinib ko'ring`,
      retry_after_sec: pw.retryAfterSec,
    });
  }
  return res.status(403).json({ error: `Parol noto'g'ri (${pw.attemptsLeft} ta urinish qoldi)` });
}

router.get('/security/status', authMiddleware, async (req, res) => {
  res.json(await security.status(req.user.id));
});

// ---------- Tranzaksiya PIN ----------
// O'rnatish va o'zgartirish bir xil: hisob PAROLI talab qilinadi (PIN unutilsa ham shu yo'l bilan tiklanadi).
// Shu sababli telefoni qo'lga tushgan, lekin parolni bilmaydigan odam PIN'ni o'zgartira/olib tashlay olmaydi.
router.post('/security/pin', authMiddleware, async (req, res) => {
  const { password, pin } = req.body || {};
  if (!security.isValidPin(pin)) return res.status(400).json({ error: "PIN 4 dan 6 gacha raqamdan iborat bo'lishi kerak" });
  const pw = await security.checkPassword(req.user.id, password);
  if (!pw.ok) return passwordFailure(res, pw);
  await security.setPin(req.user.id, pin);
  res.json({ ok: true, has_pin: true });
});

router.post('/security/pin/remove', authMiddleware, async (req, res) => {
  const pw = await security.checkPassword(req.user.id, (req.body || {}).password);
  if (!pw.ok) return passwordFailure(res, pw);
  await security.clearPin(req.user.id);
  res.json({ ok: true, has_pin: false });
});

// ---------- Biometrik qulf (Face ID / Touch ID / Windows Hello) ----------
function bioFail(res, e) {
  if (e instanceof biometric.BioError) return res.status(e.status).json({ error: e.message, ...e.extra });
  console.error('Biometrik xato:', e);
  res.status(500).json({ error: 'Server xatosi' });
}
async function needPin(req, res) {
  const st = await security.status(req.user.id);
  if (!st.has_pin) { res.status(400).json({ error: "Avval tranzaksiya PIN o'rnating" }); return false; }
  return true;
}

router.get('/security/bio', authMiddleware, async (req, res) => {
  res.json({ credentials: await biometric.publicList(req.user.id) });
});

// Yoqish: hisob PAROLI talab qilinadi (PIN o'rnatish bilan bir xil himoya)
router.post('/security/bio/register/options', authMiddleware, async (req, res) => {
  try {
    if (!(await needPin(req, res))) return;
    const pw = await security.checkPassword(req.user.id, (req.body || {}).password);
    if (!pw.ok) return passwordFailure(res, pw);
    res.json(await biometric.registerOptions(req.user.id, req));
  } catch (e) { bioFail(res, e); }
});
router.post('/security/bio/register/finish', authMiddleware, async (req, res) => {
  try { res.json(await biometric.registerFinish(req.user.id, req, req.body)); } catch (e) { bioFail(res, e); }
});

// PIN o'rnida ishlatish
router.post('/security/bio/auth/options', authMiddleware, async (req, res) => {
  try {
    if (!(await needPin(req, res))) return;
    res.json(await biometric.authOptions(req.user.id, req));
  } catch (e) { bioFail(res, e); }
});
router.post('/security/bio/auth/verify', authMiddleware, async (req, res) => {
  try { res.json(await biometric.authVerify(req.user.id, req, req.body)); } catch (e) { bioFail(res, e); }
});

router.post('/security/bio/remove', authMiddleware, async (req, res) => {
  try {
    const pw = await security.checkPassword(req.user.id, (req.body || {}).password);
    if (!pw.ok) return passwordFailure(res, pw);
    await biometric.remove(req.user.id, (req.body || {}).id);
    res.json({ ok: true, bio_count: await biometric.count(req.user.id) });
  } catch (e) { bioFail(res, e); }
});

// ---------- Hisobni muzlatish ----------
// hours: 1..720 yoki bo'sh (muddatsiz). Muzlatish uchun PIN shart emas (bu faqat xavfsizroq qiladi),
// lekin yoqish (unfreeze) PIN o'rnatilgan bo'lsa PIN so'raydi.
router.post('/security/freeze', authMiddleware, async (req, res) => {
  const raw = (req.body || {}).hours;
  let hours = null;
  if (raw !== undefined && raw !== null && raw !== '' && Number(raw) !== 0) {
    hours = Number(raw);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_FREEZE_HOURS) {
      return res.status(400).json({ error: `Muddat 1 dan ${MAX_FREEZE_HOURS} soatgacha bo'lishi kerak` });
    }
  }
  const until = await security.freeze(req.user.id, hours);
  res.json({ ok: true, frozen: true, frozen_until: until });
});

router.post('/security/unfreeze', authMiddleware, security.requirePin, async (req, res) => {
  await security.unfreeze(req.user.id);
  res.json({ ok: true, frozen: false });
});

// ---------- Faol qurilmalar ----------
router.get('/security/sessions', authMiddleware, async (req, res) => {
  const list = await security.listSessions(req.user.id);
  res.json(list.map(s => ({ ...s, current: s.id === req.user.sid })));
});

router.post('/security/sessions/logout-others', authMiddleware, async (req, res) => {
  const revoked = await security.revokeOthers(req.user.id, req.user.sid);
  res.json({ ok: true, revoked });
});

router.post('/security/sessions/:id/revoke', authMiddleware, async (req, res) => {
  if (req.params.id === req.user.sid) {
    return res.status(400).json({ error: "Joriy qurilmadan \"Hisobdan chiqish\" tugmasi orqali chiqing" });
  }
  const n = await security.revokeSession(req.params.id, req.user.id);
  if (!n) return res.status(404).json({ error: 'Qurilma topilmadi' });
  res.json({ ok: true });
});

// ---------- Kirish tarixi ----------
router.get('/security/logins', authMiddleware, async (req, res) => {
  res.json(await security.listLogins(req.user.id, 50));
});

module.exports = router;
