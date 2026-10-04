MTshop V1.3 — tayyor versiya fayli

Nima bor:
- frontend/versions/1.3/index.html — V1.3 sahifasi.

O‘rnatish:
1. ZIP ichidagi frontend papkasini MTshop loyihangizning ildiziga tashlang.
2. Natijada quyidagisi bo‘lishi kerak:
   frontend/versions/1.3/index.html
3. O‘zgarishni GitHub'ga push qiling va Render deploy tugashini kuting.
4. Admin panel -> 🆕 Versiya bo‘limiga kiring.
5. Versiya: 1.3
6. Nomi: masalan, Yangi funksiyalar
7. Changelog yozing.
8. Qo‘shish tugmasini bosing.
9. Avval draft holatda admin sifatida sinang.
10. Hammasi ishlasa beta yoki public holatiga o‘tkazing.

Muhim:
- Serverdagi BASE_VERSION 1.2 bo‘lib qoladi. Bu V1.3 uchun to‘g‘ri: 1.2 asosiy/fallback versiya bo‘lib turadi.
- Admin paneldagi eski V1.1 fayl topilmadi degan xato V1.1 uchun frontend/versions/1.1/index.html yo‘qligidan kelgan. V1.3 uchun bu ZIP kerakli faylni qo‘shadi.
- Agar 1.3 ni public qilsangiz, barcha foydalanuvchilar shu faylni ko‘rishi uchun serverda frontend/versions/1.3/index.html mavjud bo‘lishi shart.
