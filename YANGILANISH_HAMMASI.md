# MTshop: hamma tuzatishlar (bitta zip)

## Uyda nima qilasiz
1. Zipni loyiha papkasiga oching (mtshop/) — "Replace/Almashtirish" ni tanlang. Fayllar o'z yo'liga tushadi.
2. Renderda Environment ga JWT_SECRET qo'shilganini tekshiring (uzun tasodifiy matn, kamida 16 belgi).
   Qo'shilmagan bo'lsa ham sayt ishlaydi, lekin har qayta ishga tushganda hamma tizimdan chiqadi va logda
   "XAVFSIZLIK: JWT_SECRET o'rnatilmagan" yozuvi chiqadi.
3. Deploydan keyin brauzerda Ctrl+Shift+R. Yangi ustunlar server ishga tushganda o'zi qo'shiladi (migratsiya kerak emas).

## A) Gift turi (Helloween) tuzatishlari
- Tur o'chirilsa, uni olganlarda gift o'z nomi, rasmi va narxi bilan QOLADI (tur arxivlanadi). Hech kimda bo'lmasa to'liq o'chadi.
- Tur nomi/rasmi/narxi Trade, AirDrop, ochiq profil, qadalgan giftlar, "gift keldi" oynasi va admin Transfer tarixida to'g'ri ko'rinadi.
- Emoji status tur bo'yicha ishlaydi (Helloween tanlansa Helloween rasmi chiqadi).
- Eslatma: avval xato bilan o'chirib yuborilgan turlar o'zi qaytmaydi.

## B) Xavfsizlik va ishonchlilik
1. JWT_SECRET: ochiq standart kalit hostingda endi ishlatilmaydi (auth.js).
2. Hisobni o'chirish: endi haqiqiy tranzaksiya (yo'lda xato bo'lsa hech narsa o'chmaydi) va
   coin_purchases, user_card_styles, webauthn, daily case, bildirishnoma jadvallari ham tozalanadi (routes/users.js).
3. Admin huquqi har so'rovda bazadan tekshiriladi: adminlikdan olingan yoki bloklangan foydalanuvchi eski token bilan ham kira olmaydi (auth.js).
4. Gift sotib olish: son, coin va giftlar bitta tranzaksiyada; bir martada ko'pi bilan 999 ta (routes/gifts.js).
5. Login: bir IP+username uchun 10 daqiqada 8 ta xato, bir IP uchun 40 ta xatodan keyin vaqtincha to'xtatiladi
   (yangi fayl loyiha ichida: backend/src/loginGuard.js); parol tekshiruvi asinxron (server qotmaydi).

## Hali qilinmagan (keyingi navbat)
- /transfers/case (case yuborish) atomik emas, egasini tekshirmaydi
- Gift o'chirish atomik emas va bog'liq yozuvlarni (trade_items, kredit garovi) tozalamaydi
- Admin parolni o'zgartirsa eski sessiyalar tugamaydi
