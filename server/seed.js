// Тестовые данные. Запускается вручную: npm run seed. Никогда не в production.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { openDb, UPLOADS_DIR } from './lib/db.js';
import { hashPassword } from './lib/password.js';

if (process.env.NODE_ENV === 'production') {
  console.error('seed запрещён при NODE_ENV=production');
  process.exit(1);
}

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n || db.prepare('SELECT COUNT(*) AS n FROM drinks').get().n) {
  console.error('База не пуста — seed не выполнен. Удалите файл базы, чтобы начать с нуля.');
  process.exit(1);
}

const drinkRows = [
  ['Red Bull', 'Red Bull', 0, '#1e3a8a'],
  ['Monster Energy', 'Monster', 0, '#166534'],
  ['Monster Ultra White', 'Monster', 1, '#9ca3af'],
  ['Burn Original', 'Burn', 0, '#b91c1c'],
  ['Adrenaline Rush', 'Adrenaline', 0, '#7c2d12'],
  ['Flash Up Energy', 'Flash Up', 0, '#ca8a04'],
  ['Tornado Energy', 'Tornado', 0, '#4c1d95'],
  ['Gorilla', 'Gorilla', 0, '#111827'],
];
const userRows = [
  ['evgen', 'Москва', 'evgen.svg'],
  ['max', 'Санкт-Петербург', null],
  ['dimon', null, null],
  ['kate', 'Нижний Новгород', 'kate.svg'],
];
// [участник, энергетик, оценка, магазин] — номера с 1
const ratingRows = [
  [1, 1, 9, 'Пятёрочка'], [1, 2, 8, null], [1, 3, 9, 'ВкусВилл'], [1, 4, 7, 'Магнит'],
  [1, 5, 8, null], [1, 6, 6, 'АЗС Лукойл'], [1, 7, 5, null],
  [2, 1, 8, 'Перекрёсток'], [2, 2, 9, null], [2, 3, 10, 'Магнит'], [2, 6, 5, null], [2, 7, 6, 'Пятёрочка'],
  [3, 1, 9, null], [3, 2, 7, 'АЗС Лукойл'], [3, 4, 6, null], [3, 5, 7, 'Магнит'], [3, 6, 7, null],
  [4, 2, 8, 'Пятёрочка'], [4, 3, 8, null], [4, 4, 8, 'ВкусВилл'], [4, 6, 6, null],
];

mkdirSync(UPLOADS_DIR, { recursive: true });
const insDrink = db.prepare('INSERT INTO drinks (name, brand, sugar_free, color) VALUES (?,?,?,?)');
const insUser = db.prepare('INSERT INTO users (nick, password_hash, avatar, city) VALUES (?,?,?,?)');
const insRating = db.prepare('INSERT INTO ratings (user_id, drink_id, score, store) VALUES (?,?,?,?)');

const envLines = [];
const users = [];
for (const [nick, city, file] of userRows) {
  const password = randomBytes(18).toString('base64url');
  users.push([nick, city, file, await hashPassword(password)]);
  envLines.push(`SEED_PASSWORD_${nick.toUpperCase()}=${password}`);
}

db.exec('BEGIN');
try {
  const drinkIds = drinkRows.map((r) => Number(insDrink.run(...r).lastInsertRowid));
  const userIds = users.map(([nick, city, file, hash]) => {
    if (file) copyFileSync(join(import.meta.dirname, 'seed', file), join(UPLOADS_DIR, file));
    return Number(insUser.run(nick, hash, file, city).lastInsertRowid);
  });
  for (const [u, d, score, store] of ratingRows) insRating.run(userIds[u - 1], drinkIds[d - 1], score, store);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

// Пароли — только в server/.env.local (в git не попадает), в консоль не выводятся.
const envPath = join(import.meta.dirname, '.env.local');
const kept = existsSync(envPath)
  ? readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('SEED_PASSWORD_'))
  : [];
writeFileSync(envPath, [...kept, ...envLines].join('\n') + '\n', { mode: 0o600 });
console.log(`seed done: ${drinkRows.length} drinks, ${userRows.length} users, ${ratingRows.length} ratings (passwords in server/.env.local)`);
