# Sayt versiyalari

Har bir yangi versiya shu papkada alohida joylashadi (ochiq `public/` papkasida EMAS,
shuning uchun uni faqat ruxsati bor foydalanuvchi ko'ra oladi):

```
frontend/versions/1.3/index.html
frontend/versions/1.4/index.html
```

Asosiy versiya (1.2) — `frontend/public/index.html`.

## Yangi versiyani chiqarish
1. `frontend/versions/<versiya>/index.html` ni yozing va serverga deploy qiling.
2. Admin panel -> **🆕 Versiya** -> versiya raqamini qo'shing (holati `draft`).
3. Adminlar o'z Profils sahifasida "Yuklab olish" orqali sinab ko'radi.
4. `beta` qilib, tanlangan testerlarga oching.
5. `public` qilsangiz hamma foydalanuvchiga ochiladi va push bildirishnoma ketadi.
6. Xato chiqsa — `draft` ga tushiring: foydalanuvchilar avtomatik V1.2 ga qaytadi.

## Muhim: yangi versiyada "Eski versiyaga qaytish" tugmasi bo'lsin
Yangi versiyaning Profils sahifasiga shu kodni qo'shing:

```js
async function revertToBase() {
  await fetch('/api/versions/switch', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '1.2' }),
  });
  location.reload();
}
```

## Qoidalar
- Yangi versiya ham xuddi shu backend va bazadan foydalanadi, shuning uchun API va baza
  o'zgarishlari orqaga mos (V1.2 buzilmaydigan) bo'lishi kerak.
- Coin, case, kredit, pet hisob-kitoblari faqat serverda bo'lsin.
