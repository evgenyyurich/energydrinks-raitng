// Выдать или снять роль администратора: npm run admin -- <ник> [--revoke]. Работает и в production.
import { openDb } from './lib/db.js';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const nick = args.find((a) => !a.startsWith('--'));
if (!nick) {
  console.error('Использование: node server/make-admin.js <ник> [--revoke]');
  process.exit(1);
}

const db = openDb();
const res = db.prepare('UPDATE users SET is_admin = ? WHERE nick = ?').run(revoke ? 0 : 1, nick);
if (!res.changes) {
  console.error(`Пользователь «${nick}» не найден.`);
  process.exit(1);
}
console.log(revoke ? `${nick}: роль администратора снята.` : `${nick}: теперь администратор.`);
