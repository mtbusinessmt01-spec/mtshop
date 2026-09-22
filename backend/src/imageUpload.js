const multer = require('multer');

// Rasmlarni diskka emas, xotiraga (keyin bazaga base64 sifatida) saqlaymiz.
// Bu Render kabi vaqtinchalik disk fayl tizimiga ega serverlarda ham
// rasmlar yo'qolib qolmasligini ta'minlaydi (Turso'da doimiy saqlanadi).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB gacha
});

function fileToDataUrl(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

module.exports = { upload, fileToDataUrl };
