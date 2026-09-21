const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

// Turso ma'lumotlari muhit o'zgaruvchilaridan olinadi (.env yoki hosting sozlamalaridan)
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error('XATO: TURSO_DATABASE_URL muhit o\'zgaruvchisi topilmadi. .env faylini tekshiring.');
  process.exit(1);
}

const client = createClient({ url, authToken });

// Qatorni {ustun: qiymat} formatiga o'giradi (libsql Row proxy o'rniga oddiy JS obyekt)
function toObj(columns, row) {
  const obj = {};
  columns.forEach((c, i) => { obj[c] = row[i]; });
  return obj;
}

// better-sqlite3'ga o'xshash interfeys, lekin async (chunki Turso tarmoq orqali ishlaydi)
function prepare(sql) {
  return {
    async get(...args) {
      const res = await client.execute({ sql, args });
      if (!res.rows.length) return undefined;
      return toObj(res.columns, res.rows[0]);
    },
    async all(...args) {
      const res = await client.execute({ sql, args });
      return res.rows.map(r => toObj(res.columns, r));
    },
    async run(...args) {
      const res = await client.execute({ sql, args });
      return { lastInsertRowid: Number(res.lastInsertRowid || 0), changes: res.rowsAffected };
    },
  };
}

// better-sqlite3'dagi db.transaction(fn) o'rnini bosadi — fn ichida await bilan chaqiriladi
function transaction(fn) {
  return async (...args) => {
    return await fn(...args);
  };
}

async function ensureColumn(table, column, definition) {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  const cols = res.rows.map(r => r[1]); // 'name' ustuni PRAGMA table_info'da index 1
  if (!cols.includes(column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await client.executeMultiple(schema);

  // Eski bazalarda yo'q bo'lgan ustunlarni qo'shib qo'yamiz
  await ensureColumn('user_pets', 'name', 'TEXT');
  await ensureColumn('transfers', 'is_anonymous', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('transfers', 'seen', 'INTEGER NOT NULL DEFAULT 0');

  console.log('Turso bazasi tayyor.');
}

module.exports = { prepare, transaction, initDb, client };
