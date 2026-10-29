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

// body — объект (уйдёт как JSON) или Blob картинки (уйдёт как есть с её Content-Type: image/jpeg и т.п.).
async function request(method, path, body) {
  const isBlob = body instanceof Blob;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // Любой не-GET без картинки всегда уходит как JSON (сервер требует application/json для защиты от CSRF).
    headers: method === 'GET' ? {} : { 'Content-Type': isBlob ? body.type : 'application/json' },
    body: method === 'GET' ? undefined : isBlob ? body : JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(data?.error || `http_${res.status}`), { status: res.status, code: data?.error, data });
  return data;
}

const refreshMe = async () => setMe((await request('GET', '/api/me')).user);
channel?.addEventListener('message', () => refreshMe().catch(console.error));

// Превращает ошибку в понятное сообщение; field — подсказка для подсветки поля, id — существующий дубликат.
function apiError(err) {
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
    case 'auth_required':
      return { message: 'Войдите, чтобы это сделать.' };
    case 'forbidden':
      return { message: 'Это можно делать только автору энергетика.' };
    case 'forbidden_origin':
      return { message: 'Запрос отклонён. Обновите страницу и попробуйте ещё раз.' };
    case 'not_found':
      return { message: 'Не найдено — возможно, это уже удалили. Обновите страницу.' };
    case 'duplicate':
      return { message: 'Такой энергетик уже есть', id: err.data?.id, field: 'name' };
    case 'name_invalid':
      return { message: 'Название обязательно, не длиннее 60 символов.', field: 'name' };
    case 'brand_invalid':
      return { message: 'Бренд обязателен, не длиннее 40 символов.', field: 'brand' };
    case 'volume_invalid':
      return { message: 'Объём: целое число от 50 до 2000 мл.', field: 'volume' };
    case 'caffeine_invalid':
      return { message: 'Кофеин: целое число от 0 до 100 мг на 100 мл.', field: 'caffeine' };
    case 'color_invalid':
      return { message: 'Выберите цвет банки из списка.' };
    case 'score_invalid':
      return { message: 'Оценка — целое число от 1 до 10.' };
    case 'store_invalid':
      return { message: 'Магазин: не длиннее 100 символов.', field: 'store' };
    case 'city_invalid':
      return { message: 'Город: не длиннее 60 символов.', field: 'city' };
    case 'too_large':
      return { message: 'Файл слишком большой (не больше 2 МБ).' };
    case 'bad_image':
    case 'unsupported_media_type':
      return { message: 'Подходят только фото JPEG, PNG или WebP.' };
    case 'bad_request':
      return { message: 'Проверьте введённые данные.' };
    default:
      return { message: 'Что-то пошло не так. Попробуйте ещё раз.' };
  }
}
async function auth(path, nick, password) {
  try {
    setMe((await request('POST', path, { nick, password })).user, true);
  } catch (err) {
    console.error(err);
    throw apiError(err);
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

// ---------- Запись данных (нужен вход) ----------
// Ошибки приходят уже в виде { message, field?, id? } — их можно показывать как есть.

async function write(method, path, body) {
  try {
    return await request(method, path, body);
  } catch (err) {
    console.error(err);
    throw apiError(err);
  }
}

export const rate = (drinkId, score, store) => write('PUT', `/api/ratings/${drinkId}`, { score, store });
export const unrate = (drinkId) => write('DELETE', `/api/ratings/${drinkId}`);

export const createDrink = (drink) => write('POST', '/api/drinks', drink);
export const updateDrink = (id, drink) => write('PATCH', `/api/drinks/${id}`, drink);
export const deleteDrink = (id) => write('DELETE', `/api/drinks/${id}`);
export const uploadDrinkImage = (id, blob) => write('PUT', `/api/drinks/${id}/image`, blob);
export const deleteDrinkImage = (id) => write('DELETE', `/api/drinks/${id}/image`);

export const updateProfile = (city) => write('PATCH', '/api/me', { city });
export const uploadAvatar = (blob) => write('PUT', '/api/me/avatar', blob);
export const deleteAvatar = () => write('DELETE', '/api/me/avatar');
