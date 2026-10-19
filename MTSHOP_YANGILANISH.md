# MTshop yangilanishi: coin packlar va MTbank

Bu arxivdagi fayllarni MTshop loyihangizdagi shu yo'llarga nusxalang (bor fayllarni almashtiring):

| Fayl | Nima o'zgardi |
|---|---|
| `backend/db/migrations/009_add_coin_packs.sql` | YANGI: `coin_packs` va `coin_purchases` jadvallari |
| `backend/src/bank.js` | YANGI: MTbank bilan imzolangan aloqa |
| `backend/src/routes/coinPacks.js` | YANGI: packlar, sotib olish, webhook, admin |
| `backend/src/server.js` | `rawBody` (imzo uchun) va yangi router ulandi |
| `backend/.env.example` | `BANK_URL`, `MERCHANT_SECRET` qo'shildi |
| `frontend/public/admin.html` | "🪙 Packlar" menyusi |
| `frontend/public/index.html` | Shops'da "Coin sotib olish", MTbank'dan qaytishni qayta ishlash |

## Render'da MTshop servisiga qo'shing

```
BANK_URL=https://mtbank.onrender.com
MERCHANT_SECRET=<MTbank'dagi bilan aynan bir xil, kamida 32 belgi>
```

Keyin qayta deploy qiling. Yangi paket kerak emas (`multer` va boshqalar allaqachon bor).

## Tekshirish

1. MTshop admin → 🪙 Packlar → necha coin, narx (so'm), rasm → Yaratish.
2. MTbank admin (`/admin`) → hisob yarating, balansni to'ldiring.
3. MTshop'da foydalanuvchi bilan Shops → Coin sotib olish → pack → MTbank'da to'lash.
4. MTbank'da kiring, "To'lash" ni bosing. MTshop'ga qaytganingizda coin qo'shilgan bo'ladi.

## Eslatma

- Fayllar sizning yuklagan nusxangiz asosida o'zgartirilgan. Agar `index.html` yoki `admin.html` ni shu orada boshqa joyda o'zgartirgan bo'lsangiz, ularni almashtirmasdan, faqat qo'shilgan bloklarni (`coinPack`, `handleBankReturn`, `packs`) ko'chiring.
- Coin xaridlari MTshop'dagi PIN/muzlatish tekshiruvlaridan o'tmaydi: pul MTbank'dan to'lanadi, MTshop'da faqat coin qo'shiladi.
