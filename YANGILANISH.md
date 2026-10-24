# AirDrop — noutbuk uchun moslashtirish

Fayllarni loyihadagi shu yo'llarga almashtiring (3 ta fayl):

- backend/src/airdrop.js
- backend/src/routes/airdrop.js
- frontend/public/airdrop.js

GitHub'ga yuklagach Render'da Web Service "mtshop" -> Manual Deploy -> Deploy latest commit.

## Aniqlik qoidasi (yangi)
- <= 50 m: aniq (telefon GPS) — masofa to'g'ridan-to'g'ri radiusga solishtiriladi
- 50..500 m: taxminiy (noutbuk Wi-Fi) — radiusga aniqlik xatosi qo'shiladi
  (bir Wi-Fi/bir public IP bo'lsa +300 m gacha, turli tarmoqda +120 m gacha)
- > 500 m: ishonchsiz (IP bo'yicha joylashuv) — hech kim ko'rinmaydi
- "Yaqin" bo'lgach chiqib ketish chegarasi 35% kengroq — Wi-Fi joylashuvi sakrab, odam yo'qolib-paydo bo'lmaydi
- Render env (ixtiyoriy): AIRDROP_MAX_ACCURACY_M (50), AIRDROP_COARSE_MAX_M (500)
