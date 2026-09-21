// Ishlatish: node src/seed-admin.js admin_username admin_parol
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const [,, username, password] = process.argv;

async function main() {
  if (!username || !password) {
    console.log('Ishlatish: node src/seed-admin.js <username> <parol>');
    process.exit(1);
  }

  await db.initDb();

  const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    console.log('Bu username allaqachon mavjud.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(
    'INSERT INTO users (username, password_hash, coin_balance, is_admin) VALUES (?, ?, 0, 1)'
  ).run(username, hash);

  console.log(`Admin hisob yaratildi: ${username}`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
