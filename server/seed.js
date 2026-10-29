// Тестовые данные. Запускается вручную: npm run seed. Никогда не в production.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { openDb, DB_PATH, UPLOADS_DIR } from './lib/db.js';
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
  ['evgen', 'Евгений', 'Москва', 'evgen.svg'],
  ['max', null, 'Санкт-Петербург', null],
  ['dimon', null, null, null],
  ['kate', 'Катя', 'Нижний Новгород', 'kate.svg'],
];
// [участник, энергетик, оценка, магазин, цена ₽ (необязательно)] — номера с 1
const ratingRows = [
  [1, 1, 9, 'Пятёрочка', 169], [1, 2, 8, null], [1, 3, 9, 'ВкусВилл', 149], [1, 4, 7, 'Магнит', 119],
  [1, 5, 8, null], [1, 6, 6, 'АЗС Лукойл', 139], [1, 7, 5, null],
  [2, 1, 8, 'Перекрёсток', 179], [2, 2, 9, null, 129], [2, 3, 10, 'Магнит', 159], [2, 6, 5, null], [2, 7, 6, 'Пятёрочка'],
  [3, 1, 9, null, 165], [3, 2, 7, 'АЗС Лукойл', 199], [3, 4, 6, null], [3, 5, 7, 'Магнит', 99], [3, 6, 7, null],
  [4, 2, 8, 'Пятёрочка', 125], [4, 3, 8, null], [4, 4, 8, 'ВкусВилл', 109], [4, 6, 6, null, 79],
];

mkdirSync(UPLOADS_DIR, { recursive: true });
const insDrink = db.prepare('INSERT INTO drinks (name, brand, sugar_free, color) VALUES (?,?,?,?)');
const insUser = db.prepare('INSERT INTO users (nick, name, password_hash, avatar, city) VALUES (?,?,?,?,?)');
const insRating = db.prepare('INSERT INTO ratings (user_id, drink_id, score, store, price) VALUES (?,?,?,?,?)');

const envLines = [];
const users = [];
for (const [nick, name, city, file] of userRows) {
  const password = randomBytes(18).toString('base64url');
  users.push([nick, name, city, file, await hashPassword(password)]);
  envLines.push(`SEED_PASSWORD_${nick.toUpperCase()}=${password}`);
}

db.exec('BEGIN');
try {
  const drinkIds = drinkRows.map((r) => Number(insDrink.run(...r).lastInsertRowid));
  const userIds = users.map(([nick, name, city, file, hash]) => {
    if (file) copyFileSync(join(import.meta.dirname, 'seed', file), join(UPLOADS_DIR, file));
    return Number(insUser.run(nick, name, hash, file, city).lastInsertRowid);
  });
  for (const [u, d, score, store, price] of ratingRows) insRating.run(userIds[u - 1], drinkIds[d - 1], score, store, price ?? null);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

// Пароли — только в server/.env.local (в git не попадает), в консоль не выводятся.
// Пишем их лишь при посеве штатной dev-базы: для временной базы (свой DB_PATH) пароли нигде не сохраняются,
// иначе они затёрли бы пароли пользователей настоящей dev-базы.
const defaultDbPath = resolve(import.meta.dirname, 'data', 'app.db');
let note;
if (DB_PATH === defaultDbPath) {
  const envPath = join(import.meta.dirname, '.env.local');
  const kept = existsSync(envPath)
    ? readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('SEED_PASSWORD_'))
    : [];
  writeFileSync(envPath, [...kept, ...envLines].join('\n') + '\n', { mode: 0o600 });
  note = 'passwords in server/.env.local';
} else {
  note = 'custom DB_PATH: passwords not saved, server/.env.local untouched';
}
console.log(`seed done: ${drinkRows.length} drinks, ${userRows.length} users, ${ratingRows.length} ratings (${note})`);
