// Собственный сервер: JSON API + (в production) раздача собранного фронтенда.
// Без фреймворка — только node:http, чтобы не тянуть зависимости.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, unlink } from 'node:fs/promises';
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
const MAX_BODY = 16 * 1024; // JSON
const MAX_UPLOAD = 2 * 1024 * 1024; // картинки (браузер заранее ужимает до ~100–300 КБ)
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const db = openDb();
const q = {
  drinks: db.prepare('SELECT id, name, brand, sugar_free, color, image, created_by FROM drinks ORDER BY id'),
  users: db.prepare('SELECT id, nick, avatar, city FROM users ORDER BY id'),
  ratings: db.prepare('SELECT user_id, drink_id, score, store FROM ratings ORDER BY id'),
  userByNick: db.prepare('SELECT id, nick, avatar, city, password_hash FROM users WHERE nick = ?'),
  insertUser: db.prepare('INSERT INTO users (nick, password_hash) VALUES (?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(
    `SELECT u.id, u.nick, u.avatar, u.city FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ),
  drinkById: db.prepare('SELECT id, name, brand, image, created_by FROM drinks WHERE id = ?'),
  drinkNames: db.prepare('SELECT id, name, brand FROM drinks'),
  insertDrink: db.prepare(
    'INSERT INTO drinks (name, brand, sugar_free, color, created_by) VALUES (?, ?, ?, ?, ?)',
  ),
  updateDrink: db.prepare('UPDATE drinks SET name = ?, brand = ?, sugar_free = ?, color = ? WHERE id = ?'),
  setDrinkImage: db.prepare('UPDATE drinks SET image = ? WHERE id = ?'),
  deleteDrink: db.prepare('DELETE FROM drinks WHERE id = ?'),
  upsertRating: db.prepare(
    `INSERT INTO ratings (user_id, drink_id, score, store) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, drink_id) DO UPDATE SET
       score = excluded.score, store = excluded.store, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ),
  deleteRating: db.prepare('DELETE FROM ratings WHERE user_id = ? AND drink_id = ?'),
  userById: db.prepare('SELECT id, nick, avatar, city FROM users WHERE id = ?'),
  setCity: db.prepare('UPDATE users SET city = ? WHERE id = ?'),
  setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
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
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra; // доп. поля ответа, например id существующего энергетика
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

// CSRF: только JSON и Origin, совпадающий с сайтом. Маршруты загрузки картинок дополнительно принимают
// image/jpeg|png|webp (extraTypes): это не «простые» типы CORS, поэтому чужая форма их отправить не может.
function checkCsrf(req, extraTypes = []) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !extraTypes.includes(type)) throw new HttpError(415, 'unsupported_media_type');
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

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readBody(req, MAX_BODY);
  try {
    const body = JSON.parse(raw.toString('utf8'));
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

// Запись только для вошедших; заодно общий лимит на запись с одного IP.
function requireUser(req) {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, 'auth_required');
  rateLimit('write', clientIp(req), 120);
  return user;
}

// ---------- Проверка входных данных ----------

// Строка: обрезаем пробелы по краям, без управляющих символов; пустая необязательная -> null.
function cleanStr(v, { max, required = false, code }) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, code);
  const s = v.trim();
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new HttpError(400, code);
  if (required && !s) throw new HttpError(400, code);
  if ([...s].length > max) throw new HttpError(400, code);
  return s || null;
}

function cleanInt(v, min, max, code) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, code);
  return v;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cleanDrink(body) {
  const color = body.color ?? '#1e3a8a';
  if (typeof color !== 'string' || !COLOR_RE.test(color)) throw new HttpError(400, 'color_invalid');
  if (typeof (body.sugarFree ?? false) !== 'boolean') throw new HttpError(400, 'bad_request');
  return {
    name: cleanStr(body.name, { max: 60, required: true, code: 'name_invalid' }),
    brand: cleanStr(body.brand, { max: 40, required: true, code: 'brand_invalid' }),
    sugarFree: body.sugarFree ? 1 : 0,
    color: color.toLowerCase(),
  };
}

// Название + бренд без учёта регистра (в т.ч. кириллица, которую SQLite lower() не понимает).
const nameKey = (d) => `${d.name.trim().toLocaleLowerCase('ru')}\0${d.brand.trim().toLocaleLowerCase('ru')}`;
function assertNotDuplicate(d, exceptId = 0) {
  const key = nameKey(d);
  const dup = q.drinkNames.all().find((x) => x.id !== exceptId && nameKey(x) === key);
  if (dup) throw new HttpError(409, 'duplicate', { id: dup.id });
}

// Маршруты вида /api/drinks/:id — только числовые id.
function idParam(s) {
  if (!/^[1-9]\d{0,9}$/.test(s)) throw new HttpError(404, 'not_found');
  return Number(s);
}

function drinkOf(idStr) {
  const drink = q.drinkById.get(idParam(idStr));
  if (!drink) throw new HttpError(404, 'not_found');
  return drink;
}

// Править и удалять энергетик может только тот, кто его добавил.
function ownDrink(user, idStr) {
  const drink = drinkOf(idStr);
  if (drink.created_by === null || drink.created_by !== user.id) throw new HttpError(403, 'forbidden');
  return drink;
}

// ---------- Картинки ----------

// Тип определяем по первым байтам, а не по заголовку или имени файла. SVG и прочее не принимаем.
function detectImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: 'png', type: 'image/png' };
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return { ext: 'webp', type: 'image/webp' };
  return null;
}

// Читает тело запроса как картинку и сохраняет под случайным именем; возвращает имя файла.
async function receiveImage(req) {
  rateLimit('upload', clientIp(req), 20);
  const buf = await readBody(req, MAX_UPLOAD);
  const kind = detectImage(buf);
  const declared = String(req.headers['content-type']).split(';')[0].trim().toLowerCase();
  if (!kind || kind.type !== declared) throw new HttpError(400, 'bad_image');
  await mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${kind.ext}`;
  await writeFile(join(UPLOADS_DIR, name), buf, { flag: 'wx' });
  return name;
}

// Удаляет файл из папки загрузок; имя берётся из нашей базы, но проверяем и его.
async function removeUpload(name) {
  if (!name || !/^[\w.-]+$/.test(name)) return;
  try {
    await unlink(join(UPLOADS_DIR, name));
  } catch {}
}

// Сохраняет новый файл в БД через save; при ошибке убирает его и оставляет старый.
async function replaceImage(req, oldName, save) {
  const name = await receiveImage(req);
  try {
    save(name);
  } catch (err) {
    await removeUpload(name);
    throw err;
  }
  await removeUpload(oldName);
  return name;
}

// ---------- API ----------

const NICK_RE = /^[A-Za-z0-9_]{3,24}$/;

const routes = {
  'GET /api/data': (req, res) => {
    send(res, 200, {
      drinks: q.drinks.all().map((d) => ({
        id: d.id, name: d.name, brand: d.brand,
        sugarFree: !!d.sugar_free, color: d.color, image: avatarUrl(d.image), createdBy: d.created_by,
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

  'POST /api/drinks': async (req, res) => {
    checkCsrf(req);
    const user = requireUser(req);
    const d = cleanDrink(await readJson(req));
    assertNotDuplicate(d);
    let id;
    try {
      id = Number(q.insertDrink.run(d.name, d.brand, d.sugarFree, d.color, user.id).lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'duplicate');
      throw err;
    }
    send(res, 201, { id });
  },

  'PATCH /api/me': async (req, res) => {
    checkCsrf(req);
    const user = requireUser(req);
    const body = await readJson(req);
    const city = cleanStr(body.city, { max: 60, code: 'city_invalid' });
    q.setCity.run(city, user.id);
    send(res, 200, { user: publicUser(q.userById.get(user.id)) });
  },

  'PUT /api/me/avatar': async (req, res) => {
    checkCsrf(req, IMAGE_TYPES);
    const user = requireUser(req);
    const name = await replaceImage(req, user.avatar, (n) => q.setAvatar.run(n, user.id));
    send(res, 200, { avatar: avatarUrl(name) });
  },

  'DELETE /api/me/avatar': async (req, res) => {
    checkCsrf(req);
    const user = requireUser(req);
    q.setAvatar.run(null, user.id);
    await removeUpload(user.avatar);
    send(res, 200, { ok: true });
  },

  'POST /api/logout': (req, res) => {
    checkCsrf(req);
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) q.deleteSession.run(sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  },
};

// Маршруты с параметром: [метод, шаблон, обработчик(req, res, ...группы)]. Id проверяет idParam (только цифры).
const paramRoutes = [
  ['PUT', /^\/api\/ratings\/([^/]+)$/, async (req, res, idStr) => {
    checkCsrf(req);
    const user = requireUser(req);
    const drink = drinkOf(idStr);
    const body = await readJson(req);
    const score = cleanInt(body.score, 1, 10, 'score_invalid');
    const store = cleanStr(body.store, { max: 100, code: 'store_invalid' });
    q.upsertRating.run(user.id, drink.id, score, store);
    send(res, 200, { ok: true });
  }],
  ['DELETE', /^\/api\/ratings\/([^/]+)$/, async (req, res, idStr) => {
    checkCsrf(req);
    const user = requireUser(req);
    q.deleteRating.run(user.id, drinkOf(idStr).id);
    send(res, 200, { ok: true });
  }],
  ['PATCH', /^\/api\/drinks\/([^/]+)$/, async (req, res, idStr) => {
    checkCsrf(req);
    const user = requireUser(req);
    const drink = ownDrink(user, idStr);
    const d = cleanDrink(await readJson(req));
    assertNotDuplicate(d, drink.id);
    try {
      q.updateDrink.run(d.name, d.brand, d.sugarFree, d.color, drink.id);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'duplicate');
      throw err;
    }
    send(res, 200, { id: drink.id });
  }],
  ['DELETE', /^\/api\/drinks\/([^/]+)$/, async (req, res, idStr) => {
    checkCsrf(req);
    const user = requireUser(req);
    const drink = ownDrink(user, idStr);
    q.deleteDrink.run(drink.id); // оценки удаляются каскадом
    await removeUpload(drink.image);
    send(res, 200, { ok: true });
  }],
  ['PUT', /^\/api\/drinks\/([^/]+)\/image$/, async (req, res, idStr) => {
    checkCsrf(req, IMAGE_TYPES);
    const user = requireUser(req);
    const drink = ownDrink(user, idStr);
    const name = await replaceImage(req, drink.image, (n) => q.setDrinkImage.run(n, drink.id));
    send(res, 200, { image: avatarUrl(name) });
  }],
  ['DELETE', /^\/api\/drinks\/([^/]+)\/image$/, async (req, res, idStr) => {
    checkCsrf(req);
    const user = requireUser(req);
    const drink = ownDrink(user, idStr);
    q.setDrinkImage.run(null, drink.id);
    await removeUpload(drink.image);
    send(res, 200, { ok: true });
  }],
];

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
      const exact = routes[`${method} ${path}`];
      if (exact) return await exact(req, res);
      for (const [m, re, fn] of paramRoutes) {
        const hit = m === method && path.match(re);
        if (hit) return await fn(req, res, ...hit.slice(1));
      }
      const known = Object.keys(routes).some((k) => k.endsWith(` ${path}`)) || paramRoutes.some(([, re]) => re.test(path));
      throw new HttpError(known ? 405 : 404, 'not_found');
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
    if (err instanceof HttpError) {
      // Слишком большое тело: закрываем соединение, не дожидаясь остатка загрузки.
      const close = err.status === 413 ? { Connection: 'close' } : {};
      return send(res, err.status, { error: err.code, ...err.extra }, close);
    }
    console.error(err);
    send(res, 500, { error: 'server_error' });
  }
});

server.listen(PORT, HOST, () => console.log(`listening on http://${HOST}:${PORT}${PROD ? ' (production)' : ''}`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
