// User-Agent'dan qisqa qurilma nomi ("Chrome · Windows"). DB'ga bog'liq emas — alohida test qilinadi.

function parseDevice(ua) {
  const s = String(ua || '');
  let browser = "Noma'lum brauzer";
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/YaBrowser\//.test(s)) browser = 'Yandex';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  let os = "Noma'lum qurilma";
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';        // iPhone UA ichida "Mac OS X" ham bor — shuning uchun oldin
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux|X11/.test(s)) os = 'Linux';           // Android UA ichida "Linux" bor — shuning uchun keyin
  return { browser, os, label: `${browser} · ${os}` };
}

module.exports = { parseDevice };
