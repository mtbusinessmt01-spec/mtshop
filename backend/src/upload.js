const multer = require('multer');
const path = require('path');
const fs = require('fs');

function makeUploader(subfolder) {
  const dir = path.join(__dirname, '..', 'uploads', subfolder);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, name);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (/^image\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('Faqat rasm fayllari qabul qilinadi'));
    },
  });
}

module.exports = { makeUploader };
