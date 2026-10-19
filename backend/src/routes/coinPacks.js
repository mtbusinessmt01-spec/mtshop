// Coin packlar: admin yaratadi, foydalanuvchi MTbank orqali sotib oladi.
const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const bank = require('../bank');
const { authMiddleware, adminMiddleware } = require('../auth');
const { upload, fileToDataUrl } = require('../imageUpload');

const router = express.Router();
const MAX_COINS = 1_000_000;
const MAX_PRICE = 1_000_000_000;

function toInt(v) {
  if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) v = Number(v);
  return Number.isSafeInteger(v) ? v : null;
}

// ---- Coinni hisobga qo'shish: bir buyurtma uchun FAQAT BIR MARTA ----
// Bank xabari (webhook) va foydalanuvchi qaytgandagi tekshiruv bir vaqtda kelsa ham ikki marta qo'shilmaydi:
// status 'pending' -> 'paid' ga o'tishi shartli UPDATE bilan, coin qo'shish bilan bir tranzaksiyada bajariladi.
async function creditPurchase(purchaseId) {
  return db.withTx(async (tx) => {
    const upd = await tx.prepare(
      "UPDATE coin_purchases SET status='paid', paid_at=datetime('now') WHERE id=? AND status IN ('pending','failed')"
    ).run(purchaseId);
    if (upd.changes !== 1) return false;
    const p = await tx.prepare('SELECT user_id, coins FROM coin_purchases WHERE id = ?').get(purchaseId);
    await tx.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').run(p.coins, p.user_id);
    return true;
  });
}

// ---------- Foydalanuvchi ----------

router.get('/coin-packs', authMiddleware, async (req, res) => {
  const rows = await db.prepare(
    'SELECT id, coins, price_uzs, image_url FROM coin_packs WHERE is_active = 1 ORDER BY price_uzs ASC, id ASC'
  ).all();
  res.json(rows);
});

// "Sotib olish": MTbank'da to'lov so'rovi ochadi va to'lov sahifasi manzilini qaytaradi
router.post('/coin-packs/:id/buy', authMiddleware, async (req, res) => {
  if (!bank.configured()) return res.status(503).json({ error: "MTbank hali sozlanmagan. Admin bilan bog'laning" });
  const pack = await db.prepare('SELECT * FROM coin_packs WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack topilmadi' });

  const orderId = `mtshop-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const ins = await db.prepare(
    'INSERT INTO coin_purchases (user_id, pack_id, order_id, coins, price_uzs) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, pack.id, orderId, pack.coins, pack.price_uzs);

  try {
    const r = await bank.bankRequest('POST', '/api/merchant/payments', {
      order_id: orderId, title: `${pack.coins} coin`, coins: pack.coins, amount: pack.price_uzs,
      shop_user_id: req.user.id, shop_username: req.user.username,
    });
    await db.prepare('UPDATE coin_purchases SET bank_payment_id = ? WHERE id = ?').run(r.payment_id, ins.lastInsertRowid);
    res.json({ pay_url: r.pay_url });
  } catch (e) {
    console.error('MTbank to\'lov ochishda xato:', e.message);
    await db.prepare("UPDATE coin_purchases SET status='failed' WHERE id = ? AND status='pending'").run(ins.lastInsertRowid);
    res.status(502).json({ error: "MTbank hozir javob bermayapti. Bir ozdan keyin qayta urinib ko'ring" });
  }
});

// Foydalanuvchi MTbank'dan qaytganda: to'lov holatini bankdan so'raydi va to'langan bo'lsa coinni qo'shadi.
// (Bank xabari yo'lda yo'qolgan bo'lsa ham coin yo'qolmaydi.)
router.post('/coin-purchases/sync', authMiddleware, async (req, res) => {
  const paymentId = typeof (req.body || {}).payment_id === 'string' ? req.body.payment_id : '';
  if (!/^[0-9a-f]{32}$/.test(paymentId)) return res.status(400).json({ error: "To'lov ID noto'g'ri" });
  const p = await db.prepare('SELECT * FROM coin_purchases WHERE bank_payment_id = ? AND user_id = ?').get(paymentId, req.user.id);
  if (!p) return res.status(404).json({ error: 'Xarid topilmadi' });

  if (p.status === 'paid') return res.json({ status: 'paid', coins: p.coins, credited_now: false });
  try {
    const st = await bank.bankRequest('GET', `/api/merchant/payments/${paymentId}`);
    if (st.status === 'paid' && st.order_id === p.order_id && st.amount === p.price_uzs && st.coins === p.coins) {
      const credited = await creditPurchase(p.id);
      return res.json({ status: 'paid', coins: p.coins, credited_now: credited });
    }
    res.json({ status: st.status, coins: p.coins, credited_now: false });
  } catch (e) {
    console.error('MTbank holatini so\'rashda xato:', e.message);
    res.status(502).json({ error: "To'lov holatini tekshirib bo'lmadi. Birozdan keyin qayta urinib ko'ring" });
  }
});

// MTbank "to'landi" xabarini shu yerga yuboradi (imzo tekshiriladi)
router.post('/bank/webhook', async (req, res) => {
  if (!bank.verifyIncoming(req)) return res.status(401).json({ error: 'Imzo noto\'g\'ri' });
  const b = req.body || {};
  if (b.status !== 'paid' || typeof b.order_id !== 'string') return res.json({ ok: true });
  const p = await db.prepare('SELECT * FROM coin_purchases WHERE order_id = ?').get(b.order_id);
  if (!p) return res.status(404).json({ error: 'Xarid topilmadi' });
  if (b.amount !== p.price_uzs || b.coins !== p.coins) {
    console.error('Webhook ma\'lumoti xarid bilan mos kelmadi:', b.order_id);
    return res.status(409).json({ error: 'Ma\'lumot mos kelmadi' });
  }
  await creditPurchase(p.id);
  res.json({ ok: true });
});

// ---------- Admin ----------

router.get('/admin/coin-packs', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.prepare('SELECT id, coins, price_uzs, image_url, is_active, created_at FROM coin_packs ORDER BY price_uzs ASC, id ASC').all());
});

function readPackBody(req) {
  const coins = toInt((req.body || {}).coins);
  const price = toInt((req.body || {}).price_uzs);
  if (!coins || coins <= 0 || coins > MAX_COINS) return { error: "Coin soni 1 dan katta butun son bo'lishi kerak" };
  if (!price || price <= 0 || price > MAX_PRICE) return { error: "Narx (so'm) butun musbat son bo'lishi kerak" };
  const active = (req.body || {}).is_active;
  return { coins, price, active: active === undefined ? 1 : (active === 'true' || active === true || active === '1' ? 1 : 0) };
}

router.post('/admin/coin-packs', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const v = readPackBody(req);
  if (v.error) return res.status(400).json({ error: v.error });
  const r = await db.prepare('INSERT INTO coin_packs (coins, price_uzs, image_url, is_active) VALUES (?, ?, ?, ?)')
    .run(v.coins, v.price, fileToDataUrl(req.file), v.active);
  res.json(await db.prepare('SELECT * FROM coin_packs WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/admin/coin-packs/:id', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const pack = await db.prepare('SELECT * FROM coin_packs WHERE id = ?').get(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack topilmadi' });
  const v = readPackBody(req);
  if (v.error) return res.status(400).json({ error: v.error });
  const image = req.file ? fileToDataUrl(req.file) : pack.image_url;
  await db.prepare('UPDATE coin_packs SET coins = ?, price_uzs = ?, image_url = ?, is_active = ? WHERE id = ?')
    .run(v.coins, v.price, image, v.active, pack.id);
  res.json(await db.prepare('SELECT * FROM coin_packs WHERE id = ?').get(pack.id));
});

router.delete('/admin/coin-packs/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await db.prepare('DELETE FROM coin_packs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// So'nggi xaridlar (admin nazorati uchun)
router.get('/admin/coin-purchases', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.prepare(
    `SELECT c.id, c.coins, c.price_uzs, c.status, c.created_at, c.paid_at, u.username
     FROM coin_purchases c JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 50`
  ).all());
});

module.exports = router;
