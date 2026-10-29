// Клиент нашего сервера (/api). Сессия живёт в HttpOnly-cookie, JS её не видит.

let me = null;
const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('auth') : null;

function setMe(user, broadcast = false) {
  const changed = JSON.stringify(me) !== JSON.stringify(user);
  me = user;
  if (changed) listeners.forEach((fn) => fn(me));
  if (broadcast) channel?.postMessage('changed');
}

// Текущий участник (из кэша, обновляется при входе/выходе и loadData) или null.
export const currentUser = () => me;

// Подписка на вход/выход (в том числе из другой вкладки).
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // Любой не-GET всегда уходит как JSON (сервер требует application/json для защиты от CSRF).
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `http_${res.status}`), { status: res.status, code: data?.error });
  return data;
}

const refreshMe = async () => setMe((await request('GET', '/api/me')).user);
channel?.addEventListener('message', () => refreshMe().catch(console.error));

// Превращает ошибку в понятное сообщение; field — подсказка для подсветки поля.
function authError(err) {
  if (err.status === undefined) return { message: 'Сервер недоступен. Попробуйте чуть позже.' };
  switch (err.code) {
    case 'rate_limited':
      return { message: 'Слишком много попыток. Подождите минуту и повторите.' };
    case 'wrong_credentials':
      return { message: 'Неверный ник или пароль.' };
    case 'nick_taken':
      return { message: 'Этот ник уже занят.', field: 'nick' };
    case 'nick_invalid':
      return { message: 'Ник: 3–24 символа, только латинские буквы, цифры и _.', field: 'nick' };
    case 'password_short':
      return { message: 'Пароль слишком короткий: нужно минимум 8 символов.', field: 'password' };
    case 'password_long':
      return { message: 'Пароль слишком длинный: не больше 128 символов.', field: 'password' };
    default:
      return { message: 'Что-то пошло не так. Попробуйте ещё раз.' };
  }
}

async function auth(path, nick, password) {
  try {
    setMe((await request('POST', path, { nick, password })).user, true);
  } catch (err) {
    console.error(err);
    throw authError(err);
  }
}

export const login = (nick, password) => auth('/api/login', nick, password);

// Регистрация открыта всем (только ник и пароль), сервер сразу выполняет вход.
export const register = (nick, password) => auth('/api/register', nick, password);

export async function logout() {
  let failed = null;
  try {
    await request('POST', '/api/logout');
  } catch (err) {
    console.error(err);
    failed = err;
  }
  // Локально выходим в любом случае, но если сервер не подтвердил — сообщаем об этом.
  setMe(null, true);
  if (failed) throw { message: 'Не удалось выйти на сервере, попробуйте ещё раз.' };
}

// Загружает всё одним заходом (данные уже в плоском виде) и заодно узнаёт текущего участника.
export async function loadData() {
  const [data] = await Promise.all([request('GET', '/api/data'), refreshMe()]);
  return data;
}
