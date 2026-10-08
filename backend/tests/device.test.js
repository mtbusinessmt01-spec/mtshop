// Qurilma nomini aniqlash testlari (DB va server kerak emas):  node --test tests/device.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDevice } = require('../src/device');

const cases = [
  ['Chrome / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome · Windows'],
  ['Edge / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge · Windows'],
  ['Chrome / Android', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
  ['Samsung Internet / Android', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
  ['Safari / iPhone (Mac OS X yozuvi bor, lekin iOS bo\'lishi kerak)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari · iOS'],
  ['Chrome / iPhone (CriOS)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome · iOS'],
  ['Safari / macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari · macOS'],
  ['Firefox / Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox · Linux'],
  ['Opera / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/120.0.0.0', 'Opera · Windows'],
];
for (const [name, ua, expected] of cases) {
  test(`qurilma: ${name}`, () => assert.equal(parseDevice(ua).label, expected));
}

test("bo'sh yoki g'alati User-Agent xato bermaydi", () => {
  assert.equal(parseDevice('').label, "Noma'lum brauzer · Noma'lum qurilma");
  assert.equal(parseDevice(undefined).label, "Noma'lum brauzer · Noma'lum qurilma");
  assert.equal(parseDevice('curl/8.0').label, "Noma'lum brauzer · Noma'lum qurilma");
});
