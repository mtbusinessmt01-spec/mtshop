const express = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const { requirePin, requireNotFrozen } = require('../security');
const airdrop = require('../airdrop');

const router = express.Router();

function fail(res, e) {
  if (e instanceof airdrop.AirdropError) return res.status(e.status).json({ error: e.message });
  console.error('AirDrop xatosi:', e);
  res.status(500).json({ error: 'Server xatosi' });
}

// Real-time oqim (SSE): AirDrop sahifasi ochiq turgan vaqtda ulanadi
router.get('/airdrop/stream', authMiddleware, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  airdrop.addStream(req.user.id, res);
  airdrop.sse(res, 'ready', { radius: await airdrop.getRadius() });
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* yopilgan */ } }, 20000);
  req.on('close', () => { clearInterval(ping); airdrop.removeStream(req.user.id, res); });
});

router.post('/airdrop/location', authMiddleware, async (req, res) => {
  try {
    const changed = airdrop.updateLocation(req.user.id, req.body);
    if (changed) airdrop.broadcastNearby();
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.get('/airdrop/nearby', authMiddleware, async (req, res) => {
  try { res.json(await airdrop.nearbyFor(req.user.id)); } catch (e) { fail(res, e); }
});

router.post('/airdrop/send', authMiddleware, requireNotFrozen, requirePin, async (req, res) => {
  try {
    const { to_user_id, inventory_id } = req.body || {};
    if (!to_user_id || !inventory_id) return res.status(400).json({ error: 'Foydalanuvchi va gift tanlanishi kerak' });
    if (Number(to_user_id) === req.user.id) return res.status(400).json({ error: "O'zingizga yubora olmaysiz" });
    res.json(await airdrop.send(req.user, Number(to_user_id), Number(inventory_id)));
  } catch (e) { fail(res, e); }
});

router.post('/airdrop/:id/accept', authMiddleware, async (req, res) => {
  try { res.json(await airdrop.accept(req.user.id, Number(req.params.id))); } catch (e) { fail(res, e); }
});

router.post('/airdrop/:id/decline', authMiddleware, async (req, res) => {
  try { await airdrop.resolveSimple(req.user.id, Number(req.params.id), 'receiver', 'DECLINED'); res.json({ ok: true }); }
  catch (e) { fail(res, e); }
});

router.post('/airdrop/:id/cancel', authMiddleware, async (req, res) => {
  try { await airdrop.resolveSimple(req.user.id, Number(req.params.id), 'sender', 'CANCELLED'); res.json({ ok: true }); }
  catch (e) { fail(res, e); }
});

// Admin: yaqinlik masofasi (metr)
router.get('/admin/settings/airdrop-radius', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ meters: await airdrop.getRadius() });
});
router.put('/admin/settings/airdrop-radius', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json({ ok: true, meters: await airdrop.setRadius(req.body && req.body.meters) }); } catch (e) { fail(res, e); }
});

module.exports = router;
