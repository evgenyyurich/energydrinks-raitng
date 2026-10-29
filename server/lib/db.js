import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const DB_PATH = resolve(process.env.DB_PATH || join(root, 'data', 'app.db'));
export const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || join(root, 'uploads'));

// Открывает базу и применяет ещё не применённые миграции из server/migrations/*.sql.
export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const done = new Set(db.prepare('SELECT name FROM migrations').all().map((r) => r.name));
  const dir = join(root, 'migrations');
  for (const file of readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort()) {
    if (done.has(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Миграция ${file} не применилась: ${err.message}`);
    }
    console.log(`migration applied: ${file}`);
  }
  return db;
}
