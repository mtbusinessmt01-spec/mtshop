# Kredit olishni qiyinlashtirish

## O'zgargan / yangi fayllar
- backend/src/creditRules.js            (YANGI: barcha qoidalar)
- backend/src/routes/credits.js         (almashtirildi)
- backend/src/guarantor.js              (almashtirildi)
- backend/src/db.js                     (yangi ustunlar, avtomatik qo'shiladi)
- backend/src/routes/transfers.js, trades.js, airdrop.js   (kredit qulfi)
- backend/tests/credit.test.js          (YANGI: 82 ta test)
- frontend/public/index.html, admin.html

Migratsiya qo'lda kerak emas: yangi ustunlar server ishga tushganda o'zi qo'shiladi. Yangi paket kerak emas.
Deploy'dan keyin saytni Ctrl+Shift+R bilan yangilang.

## Qanday ishlaydi
Kredit oynasi ochilganda avval shartlar ro'yxati (✅/❌) ko'rinadi, hammasi ✅ bo'lsa kredit turlari ochiladi:
akkaunt yoshi, faollik, faol kredit yo'qligi, sovutish davri, yaqinda kechikish yo'qligi, PIN, muzlatilmagan hisob, kunlik urinishlar.

Kredit bosqichlari: qarzdor so'rov yuboradi (shartlar oynasi + summani yozish + PIN)
-> kafil tasdiqlaydi (PIN) -> katta summada admin tasdiqlaydi -> qarzdor "Qabul qilaman" bosadi (10 daqiqa, PIN) -> kredit tushadi.

- Daraja: har bir o'z vaqtida yopilgan kredit keyingi (kattaroq) kredit turini ochadi; kechikish darajani tushiradi.
- Foiz: yangi qarzdorga +3%, yaxshi qarzdorga -2%, garov qo'ysa -2%.
- Garov: 500 coin va undan katta kreditlarda majburiy (gift narxi >= kredit summasi). Kredit yopilsa qaytadi, defaulted bo'lsa saytga o'tadi. Garovdagi gift sotilmaydi, yuborilmaydi, trade/airdrop/pet'ga berilmaydi.
- Kafil: akkaunt >= 14 kun, balans >= 50%, PIN bor, ko'pi bilan 2 ta kreditga kafil, qarzdor bilan bir IP dan kirmagan.
- Kredit tushgandan keyin 48 soat coin/gift/case yuborib va trade qilib bo'lmaydi (do'konda xarid qilish mumkin).

## Sozlash
Admin panel -> Kredit -> "Kredit olish qoidalari": barcha kun, foiz va summalar shu yerda o'zgaradi.
Katta kreditlar: admin panel -> Kredit -> "Admin tasdig'ini kutayotgan kreditlar".

## Eslatma
- Bir IP tekshiruvi: bir wifi/uydagi ikki odam bir-biriga kafil bo'la olmaydi. Xalaqit bersa, "Bir IP dan kirganlarni rad etish" ni 0 qiling.
- Kredit coini qulfi paytida do'konda sarflangan coin ham qulf hisobiga kiradi (qulf vaqt bilan ishlaydi, summa bilan emas).
