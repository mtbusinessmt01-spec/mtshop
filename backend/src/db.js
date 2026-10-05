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

// ---------- HAQIQIY tranzaksiya ----------
// Eslatma: yuqoridagi transaction() atomik EMAS (faqat fn ni chaqiradi). Pul/gift o'tkazadigan
// joylar uchun withTx() ishlating: BEGIN IMMEDIATE ... COMMIT, xatoda ROLLBACK.
// Yozuvchi tranzaksiyalar baza darajasida ketma-ket bajariladi (race condition yo'q).
function txPrepare(tx, sql) {
  return {
    async get(...args) {
      const res = await tx.execute({ sql, args });
      if (!res.rows.length) return undefined;
      return toObj(res.columns, res.rows[0]);
    },
    async all(...args) {
      const res = await tx.execute({ sql, args });
      return res.rows.map(r => toObj(res.columns, r));
    },
    async run(...args) {
      const res = await tx.execute({ sql, args });
      return { lastInsertRowid: Number(res.lastInsertRowid || 0), changes: res.rowsAffected };
    },
  };
}

function isBusyError(e) {
  return /SQLITE_BUSY|database is locked|BUSY/i.test((e && e.message) || '');
}

// fn(tx) ichida: tx.prepare(sql).get/all/run — hammasi bitta tranzaksiyada.
// fn xato tashlasa — butun tranzaksiya ROLLBACK qilinadi va xato qayta tashlanadi.
async function withTx(fn) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let tx;
    try {
      tx = await client.transaction('write');
    } catch (e) {
      if (isBusyError(e)) { await new Promise(r => setTimeout(r, 15 * (attempt + 1))); continue; }
      throw e;
    }
    try {
      const api = { prepare: (sql) => txPrepare(tx, sql) };
      const result = await fn(api);
      await tx.commit();
      return result;
    } catch (e) {
      try { await tx.rollback(); } catch (_) {}
      if (isBusyError(e)) { await new Promise(r => setTimeout(r, 15 * (attempt + 1))); continue; }
      throw e;
    } finally {
      try { tx.close(); } catch (_) {}
    }
  }
  throw new Error('Baza band, keyinroq urinib ko\'ring');
}

async function ensureColumn(table, column, definition) {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  const cols = res.rows.map(r => r[1]); // 'name' ustuni PRAGMA table_info'da index 1
  if (!cols.includes(column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const files = fs.readdirSync(migrationsDir)
    .filter(name => /^\d+.*\.sql$/i.test(name))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/i, '');
    const applied = await client.execute({
      sql: 'SELECT version FROM schema_migrations WHERE version = ?',
      args: [version],
    });
    if (applied.rows.length) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.executeMultiple(sql);
    await client.execute({
      sql: 'INSERT INTO schema_migrations (version) VALUES (?)',
      args: [version],
    });
    console.log(`Migration qo'llandi: ${file}`);
  }
}

async function initDb() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await client.executeMultiple(schema);
  await runMigrations();

  // Eski bazalarda yo'q bo'lgan ustunlarni qo'shib qo'yamiz
  await ensureColumn('user_pets', 'name', 'TEXT');
  // O'lgan pet qachon o'lgani (7 kun ichida tiriltirish mumkin)
  await ensureColumn('user_pets', 'died_at', 'TEXT');
  await ensureColumn('transfers', 'is_anonymous', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('transfers', 'seen', 'INTEGER NOT NULL DEFAULT 0');
  // Gift noyobligi: 'common' (oddiy), 'rare' (noyob), 'legendary' (afsonaviy) — noyob giftlar chiqqanda push yuboriladi
  await ensureColumn('gifts', 'rarity', "TEXT NOT NULL DEFAULT 'common'");
  // Event'ga tegishli gift/case (NULL = oddiy, event'siz)
  await ensureColumn('gifts', 'event_id', 'INTEGER');
  await ensureColumn('cases', 'event_id', 'INTEGER');
  // Kredit uchun kafil
  await ensureColumn('user_credits', 'guarantor_id', 'INTEGER');
  // Trade tizimi: gift qaysi trade'da band ekani, oxirgi request vaqti (20 daqiqalik cooldown), tarix bog'lanishi
  await ensureColumn('user_gifts', 'trade_id', 'INTEGER');
  await ensureColumn('users', 'last_trade_request_at', 'TEXT');
  await ensureColumn('transfers', 'trade_id', 'INTEGER');
  // Foydalanuvchi o'z Trade tarixini ko'rinishdan o'chirishi (sherik va admin audit tarixi saqlanadi)
  // Emoji status: username yonidagi gift rasmi (narxi 200 coindan yuqori gift)
  await ensureColumn('users', 'emoji_gift_id', 'INTEGER');
  await ensureColumn('trades', 'a_hidden', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('trades', 'b_hidden', 'INTEGER NOT NULL DEFAULT 0');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_user_gifts_trade ON user_gifts(trade_id)');
  // Foydalanuvchi qaysi sayt versiyasidan foydalanayotgani (asosiy versiya — 1.2)
  await ensureColumn('users', 'app_version', "TEXT NOT NULL DEFAULT '1.2'");

  console.log('Turso bazasi tayyor.');
}

module.exports = { prepare, transaction, withTx, initDb, client };
