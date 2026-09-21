# MTshop

Tayyor bo'lgan funksiyalar:
- Ma'lumotlar bazasi (barcha jadvallar: users, gifts, cases, pets, credits, transfers)
- Login tizimi (username + parol, register yo'q)
- Admin hisob yaratish skripti
- Frontend: login sahifasi + pastki menyuli asosiy sahifa (Shops, Inventor, Jo'natmoq, MyPet, Kreditlar, Profils)
- **Gift tizimi**: admin gift yaratadi/tahrirlaydi/o'chiradi (rasm bilan), foydalanuvchi Shops orqali sotib oladi, Inventor'da ko'radi va joriy narxning 80%iga orqaga sotadi
- **Admin panel** (`admin.html`): gift va case boshqaruvi (Profils sahifasidan "Admin panel" tugmasi orqali kiriladi, faqat admin hisob uchun ko'rinadi)
- **Case tizimi**: admin case yaratadi (nomi, narxi, rasmi, ichiga gift/coinlar va ularning shansi %), foydalanuvchi Shops orqali sotib oladi, Inventor'da "Ochish" tugmasi bilan ochadi (shansga qarab gift yoki coin chiqadi)
- **Animatsiyalar**: case ochishda slot-mashina uslubidagi aylanma animatsiya, gift sotib olganda pop-in animatsiya, case "Ko'rish" oynasida ichidagi narsalar % bilan ko'rsatiladi
- **Admin: Hisoblar boshqaruvi**: yangi hisob yaratish (username+parol, admin huquqi berish), tahrirlash, bloklash, o'chirish, coin berish/olish
- **Jo'natmoq (Transfer)**: foydalanuvchi boshqa foydalanuvchiga gift, coin yoki case yuboradi (username orqali). Coin yuborishda 3% komissiya olinadi. Admin panelda barcha transferlar tarixi ko'rinadi va o'chirish mumkin
- **Kredit tizimi**: admin kredit turlarini yaratadi (nomi, min/max summa, foiz, necha haftaga bo'lib to'lanadi). Foydalanuvchi "Ko'rish" oynasida tavsifni o'qib, summa kiritib kredit oladi. Bir vaqtning o'zida faqat bitta faol kredit bo'lishi mumkin. To'lash 2 xil: jadval bo'yicha yoki oldindan (o'zi xohlagan summa). Har to'lovdan keyin chek ko'rinishidagi tasdiqlash oynasi chiqadi. Vaqtida to'lamasa avtomatik 12% jarima, 3 marta jarima to'lanmasa hisob bloklanadi
- **Foydalanuvchilar menyusi**: Profils sahifasida username bo'yicha qidiruv, bosilganda profil oynasi ochiladi (username, status rasm, giftlari, case'lari, pet mavjudligi — tafsilotsiz). Admin panelda har bir foydalanuvchiga 🏷️ tugmasi orqali status rasm (badge) yuklash mumkin
- **Pet (PetShop) tizimi**: admin pet turlarini yaratadi (nomi, narxi, rasmi, har 3 soatda beradigan coin, to'yish uchun XP, LV uchun XP, shopda soni). Foydalanuvchi maksimum 2 ta pet sotib oladi, MyPet sahifasida gift berib ovqatlantiradi (gift narxi/10 = XP). 6 soatda ovqatlanmasa muddat o'tadi, 24 soatda kasal, 36 soatda o'ladi. Kasal bo'lsa 25 coin evaziga davolanadi va shu vaqtda coin ishlab topmaydi. LV oshgani sari kamroq XP kifoya qiladi
- **Drag & drop**: admin panelning barcha rasm maydonlarida (gift, case, pet, status badge) endi sudrab tashlash ishlaydi

## Oxirgi yaxshilashlar
- Shop'da gift "Ko'rish" oynasi orqali +/− tugmalari bilan miqdor tanlab sotib olinadi
- Pet'larda "Statistika" oynasi: ism qo'yish (✏️), sog'lomlik darajasi, ochqashigacha qolgan vaqt, LV va keyingi LV ma'lumoti, o'sha oynadan "Ovqatlantirish"
- Ovqatlantirishda bir xil giftlar guruhlanadi (masalan "6 ta Ayiqcha"), +/− orqali nechtasini berish tanlanadi
- Admin panel endi 6 ta alohida menyuga bo'lingan: Foydalanuvchilar, Giftlar, Case'lar, Transfer tarixi, Kredit, Pet
- Jo'natishda tasdiqlash oynasi chiqadi: narsa turi, kimga, va "Anonim sifatida yuborilsinmi?" (Ha/Yo'q) tanlovi
- Foydalanuvchi tizimga kirganda unga yuborilgan yangi gift/coin/case haqida bildirishnoma oynasi chiqadi (kimdan — agar anonim bo'lmasa), va bu faqat bir marta ko'rsatiladi

## Ishga tushirish (noutbukda)

### 1. Backend

```bash
cd backend
npm install
node src/seed-admin.js admin admin123   # birinchi admin hisobni yaratadi
node src/server.js                       # server http://localhost:4000 da ishga tushadi
```

### 2. Frontend

`frontend/public/` papkasidagi `index.html` faylini istalgan brauzerda oching
(yoki oddiy static server orqali: `npx serve frontend/public`).

Login: yuqorida yaratgan `admin` / `admin123` bilan kiring.

## Internetga joylashtirish (Turso + Render, ikkalasi ham bepul)

### 1-qadam: Turso'da baza yaratish
1. https://turso.tech saytiga kiring, "Sign up" bosing (GitHub hisobingiz bilan kirsangiz bo'ladi)
2. Dashboard'da "Create Database" tugmasini bosing, nom bering (masalan `mtshop`), yaqin regionni tanlang
3. Baza yaratilgach, "Connect" yoki shunga o'xshash bo'limdan:
   - **Database URL** (`libsql://...` bilan boshlanadi) — nusxa oling
   - **Auth Token** yarating (odatda "Create Token" tugmasi) — nusxa oling
4. Bu ikkalasini saqlab qo'ying, keyingi qadamda kerak bo'ladi

### 2-qadam: Kodni GitHub'ga yuklash
1. https://github.com saytida bepul hisob oching
2. "New repository" tugmasi bilan yangi repo yarating (nomi: `mtshop`, Public yoki Private — farqi yo'q)
3. Repo sahifasida "uploading an existing file" havolasini bosing
4. Kompyuteringizdagi `mtshop` papkasi ichidan **backend** papkasini (node_modules'siz) sudrab tashlang va "Commit changes" bosing

### 3-qadam: Render'da backend'ni joylashtirish
1. https://render.com saytida bepul hisob oching (GitHub bilan kirish qulay)
2. "New +" → "Web Service" tugmasini bosing
3. GitHub repo'ngizni tanlang
4. Sozlamalar:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. "Environment Variables" bo'limida 3 tasini qo'shing:
   - `TURSO_DATABASE_URL` = Turso'dan olgan URL
   - `TURSO_AUTH_TOKEN` = Turso'dan olgan token
   - `JWT_SECRET` = istalgan uzun tasodifiy matn
6. "Create Web Service" bosing — bir necha daqiqada tayyor bo'ladi, sizga `https://mtshop-xxxx.onrender.com` kabi manzil beriladi

### 4-qadam: Admin hisobni Turso'da yaratish
Render'ning "Shell" bo'limidan (loyihangiz sahifasida) yoki noutbukingizda `.env` faylini Turso ma'lumotlari bilan to'ldirib, mahalliyda quyidagini ishlating:
```
node src/seed-admin.js admin admin123
```
(Bu bazaga to'g'ridan-to'g'ri yozadi, qaysi joydan ishlatsangiz ham bir xil Turso bazasiga tushadi.)

### 5-qadam: Frontend'ni Render manziliga ulash
`frontend/public/config.js` faylida:
```js
const API_BASE = 'https://mtshop-xxxx.onrender.com'; // Render bergan manzil
```
Shundan keyin `frontend/public` papkasini ham xohlagan joyda (masalan shu Render'da alohida "Static Site" sifatida, yoki noutbukda `npx serve` bilan) ochsangiz, backend endi internetda ishlayapti va ma'lumotlar hech qachon o'chmaydi.

**Eslatma:** Render bepul tarifda 15 daqiqa harakatsizlikdan keyin "uxlab qoladi" va birinchi so'rovda 30-60 soniya sekinroq javob beradi — bu normal, ma'lumotlarga ta'sir qilmaydi.

- Gift tizimi (yaratish, sotish, orqaga sotish)
- Case tizimi (yaratish, ochish)
- Pet tizimi (PetShop, ovqatlantirish, LV)
- Kredit tizimi
- Transfer (Jo'natmoq) — 3% komissiya bilan
- Admin panel (barcha boshqaruv)
- Foydalanuvchilar menyusi (Profils ichida qidiruv)
