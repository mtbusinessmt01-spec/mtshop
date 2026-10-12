// Ism Familiya va rasm qoidalari testlari (DB va server kerak emas):  node --test tests/identity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFullName, sniffImage, NAME_MAX } = require('../src/identityRules');

const okName = (raw, expected) => {
  const r = normalizeFullName(raw);
  assert.equal(r.ok, true, `"${raw}" qabul qilinishi kerak edi: ${r.error}`);
  assert.equal(r.value, expected);
};
const badName = (raw) => assert.equal(normalizeFullName(raw).ok, false, `"${raw}" rad etilishi kerak edi`);

test('ism: oddiy va o\'zbekcha ismlar qabul qilinadi', () => {
  okName('Ali Valiyev', 'Ali Valiyev');
  okName("O'tkir G'ofurov", "O'tkir G'ofurov");
  okName('Oʻtkir Gʻofurov', 'Oʻtkir Gʻofurov');          // ʻ (modifier letter turned comma)
  okName('Sevara-Xon', 'Sevara-Xon');
  okName('Дмитрий Иванов', 'Дмитрий Иванов');            // kirill
  okName('Anvar Jr.', 'Anvar Jr.');
});

test('ism: ortiqcha bo\'shliqlar tozalanadi', () => {
  okName('   Ali    Valiyev  ', 'Ali Valiyev');
  okName('Ali\tValiyev\n', 'Ali Valiyev');
});

test("ism: bo'sh matn — ismni o'chirish (null)", () => {
  okName('', null);
  okName('    ', null);
  okName(null, null);
  okName(undefined, null);
});

test('ism: noto\'g\'ri qiymatlar rad etiladi', () => {
  badName('A');                                 // juda qisqa
  badName('x'.repeat(NAME_MAX + 1));            // juda uzun
  badName('Ali123');                            // raqam
  badName('<b>Ali</b>');                        // HTML
  badName('Ali; DROP TABLE users');             // belgilar
  badName('😀😀');                               // emoji
  badName("-Ali");                              // harf bilan boshlanmaydi
  badName("' '");
  badName('A.');                                // 2 ta harf yo'q
  badName('a b c d e f');                       // juda ko'p so'z
  badName(123);                                 // matn emas
  badName({ a: 1 });
});

test('ism: eng uzun ruxsat etilgan uzunlik', () => {
  okName('a'.repeat(NAME_MAX), 'a'.repeat(NAME_MAX));
});

test('rasm turi birinchi baytlardan aniqlanadi', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
  assert.equal(sniffImage(jpeg), 'image/jpeg');
  assert.equal(sniffImage(png), 'image/png');
  assert.equal(sniffImage(webp), 'image/webp');
});

test('rasm: boshqa fayllar rad etiladi (mimetypega ishonilmaydi)', () => {
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?> bu rasm emas')), null);
  assert.equal(sniffImage(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  assert.equal(sniffImage(null), null);
});
