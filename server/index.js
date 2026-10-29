// Собственный сервер: JSON API + (в production) раздача собранного фронтенда.
// Без фреймворка — только node:http, чтобы не тянуть зависимости.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { openDb, UPLOADS_DIR } from './lib/db.js';
import { hashPassword, verifyPassword, dummyHash } from './lib/password.js';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DIST = resolve(import.meta.dirname, '..', 'dist');
const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 16 * 1024;

const db = openDb();
const q = {
  drinks: db.prepare('SELECT id, name, brand, volume, caffeine, sugar_free, color FROM drinks ORDER BY id'),
  users: db.prepare('SELECT id, nick, avatar, city FROM users ORDER BY id'),
  ratings: db.prepare('SELECT user_id, drink_id, score, store FROM ratings ORDER BY id'),
  userByNick: db.prepare('SELECT id, nick, avatar, city, password_hash FROM users WHERE nick = ?'),
  insertUser: db.prepare('INSERT INTO users (nick, password_hash) VALUES (?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(
    `SELECT u.id, u.nick, u.avatar, u.city FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
};
q.purgeSessions.run(Date.now());
setInterval(() => q.purgeSessions.run(Date.now()), 3600 * 1000).unref();

// ---------- Помощники ----------

const avatarUrl = (file) => (file ? `/uploads/${encodeURIComponent(file)}` : null);
const publicUser = (u) => ({ id: u.id, nick: u.nick, avatar: avatarUrl(u.avatar), city: u.city ?? null });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (value, maxAgeSec) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${PROD ? '; Secure' : ''}`;

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',').pop().trim(); // последний — тот, кого видел наш прокси
  }
  return req.socket.remoteAddress || 'unknown';
}

// Лимитер в памяти: не больше `max` попыток с одного IP за окно.
const buckets = new Map();
function rateLimit(name, ip, max, windowMs = 60_000) {
  const key = `${name}:${ip}`;
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw new HttpError(429, 'rate_limited');
  }
  hits.push(now);
  buckets.set(key, hits);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (!hits.some((t) => now - t < 60_000)) buckets.delete(k);
}, 60_000).unref();

// CSRF: только JSON (или multipart для будущих загрузок) и Origin, совпадающий с сайтом.
function checkCsrf(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== 'multipart/form-data') throw new HttpError(415, 'unsupported_media_type');
  const origin = req.headers.origin;
  if (origin) {
    const host = (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
    let ok = ALLOWED_ORIGINS.includes(origin);
    try {
      ok = ok || new URL(origin).host === host;
    } catch {}
    if (!ok) throw new HttpError(403, 'forbidden_origin');
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, 'bad_request');
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return null;
  return q.sessionUser.get(sha256(token), Date.now()) || null;
}

function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  q.insertSession.run(sha256(token), userId, Date.now() + SESSION_MS);
  return { 'Set-Cookie': cookie(token, SESSION_MS / 1000) };
}

// ---------- API ----------

const NICK_RE = /^[A-Za-z0-9_]{3,24}$/;

const routes = {
  'GET /api/data': (req, res) => {
    send(res, 200, {
      drinks: q.drinks.all().map((d) => ({
        id: d.id, name: d.name, brand: d.brand, volume: d.volume, caffeine: d.caffeine,
        sugarFree: !!d.sugar_free, color: d.color,
      })),
      users: q.users.all().map(publicUser),
      ratings: q.ratings.all().map((r) => ({ userId: r.user_id, drinkId: r.drink_id, score: r.score, store: r.store ?? null })),
    });
  },

  'GET /api/me': (req, res) => {
    const u = sessionUser(req);
    send(res, 200, { user: u ? publicUser(u) : null });
  },

  'POST /api/register': async (req, res) => {
    checkCsrf(req);
    rateLimit('register', clientIp(req), 5);
    const { nick, password } = await readJson(req);
    if (typeof nick !== 'string' || !NICK_RE.test(nick)) throw new HttpError(400, 'nick_invalid');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'password_short');
    if (password.length > 128) throw new HttpError(400, 'password_long');
    if (q.userByNick.get(nick)) throw new HttpError(409, 'nick_taken');
    const hash = await hashPassword(password);
    let id;
    try {
      id = Number(q.insertUser.run(nick, hash).lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'nick_taken'); // гонка двух регистраций
      throw err;
    }
    send(res, 201, { user: publicUser({ id, nick, avatar: null, city: null }) }, startSession(res, id));
  },

  'POST /api/login': async (req, res) => {
    checkCsrf(req);
    rateLimit('login', clientIp(req), 10);
    const { nick, password } = await readJson(req);
    const valid = typeof nick === 'string' && typeof password === 'string' && password.length <= 128;
    const user = valid ? q.userByNick.get(nick) : null;
    // Хэш считаем всегда — время ответа не выдаёт, существует ли ник.
    const ok = await verifyPassword(valid ? password : '', user ? user.password_hash : dummyHash);
    if (!user || !ok) throw new HttpError(401, 'wrong_credentials');
    send(res, 200, { user: publicUser(user) }, startSession(res, user.id));
  },

  'POST /api/logout': (req, res) => {
    checkCsrf(req);
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) q.deleteSession.run(sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  },
};

// ---------- Статика ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

async function serveFile(req, res, base, relPath, extraHeaders = {}) {
  let rel;
  try {
    rel = decodeURIComponent(relPath);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  const file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return false;
  let st;
  try {
    st = await stat(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

// ---------- Сервер ----------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    if (path.startsWith('/api/')) {
      const handler = routes[`${method} ${path}`];
      if (!handler) throw new HttpError(Object.keys(routes).some((k) => k.endsWith(` ${path}`)) ? 405 : 404, 'not_found');
      return await handler(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');

    if (path.startsWith('/uploads/')) {
      // SVG-аватарки не должны исполнять скрипты, даже если открыть файл напрямую.
      const ok = await serveFile(req, res, UPLOADS_DIR, path.slice('/uploads/'.length), {
        'Cache-Control': 'public, max-age=3600',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      if (!ok) throw new HttpError(404, 'not_found');
      return;
    }

    if (PROD) {
      const rel = path === '/' ? 'index.html' : path.slice(1);
      const immutable = rel.startsWith('assets/');
      if (await serveFile(req, res, DIST, rel, { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })) return;
      // SPA-фолбэк: неизвестный путь без расширения отдаёт index.html.
      if (!extname(path) && (await serveFile(req, res, DIST, 'index.html', { 'Cache-Control': 'no-cache' }))) return;
    }
    throw new HttpError(404, 'not_found');
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return send(res, err.status, { error: err.code });
    console.error(err);
    send(res, 500, { error: 'server_error' });
  }
});

server.listen(PORT, HOST, () => console.log(`listening on http://${HOST}:${PORT}${PROD ? ' (production)' : ''}`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
