# Yangi PIN klaviaturasi + biometrik qulf

Fayllarni loyihadagi shu yo'llarga qo'ying (5 ta):

- backend/db/migrations/012_add_webauthn.sql   (YANGI — jadval o'zi yaratiladi)
- backend/src/biometric.js                      (YANGI)
- backend/src/security.js                       (almashtiring)
- backend/src/routes/security.js                (almashtiring)
- frontend/public/index.html                    (almashtiring — AirDrop faylidan alohida)

Yangi paket kerak emas. Deploy'dan keyin saytni Ctrl+Shift+R bilan yangilang.

## Yoqish
Profil -> Xavfsizlik -> "Biometrik qulf" -> hisob paroli -> Face ID / Touch ID / Windows Hello.
(Avval tranzaksiya PIN o'rnatilgan bo'lishi kerak. Faqat HTTPS'da ishlaydi — Render'da shunday.)

## Qanday ishlaydi
- PIN oynasi: saytning o'z klaviaturasi (noutbukda haqiqiy klaviatura ham ishlaydi: raqamlar, Backspace, Enter, Esc).
- "Biometrik qulfdan ochish" tugmasi faqat yoqilgan qurilmada chiqadi.
- Serverga yuz/barmoq izi emas, faqat ochiq kalit saqlanadi. Biometrik tasdiq PIN o'rnida bir martalik token beradi (2 daqiqa).
- PIN 5 marta xato bo'lib bloklansa, biometrik ham ishlamaydi (PIN o'chirilsa biometrik ham o'chadi).
