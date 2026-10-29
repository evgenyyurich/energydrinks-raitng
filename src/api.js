import PocketBase from 'pocketbase';

const pb = new PocketBase(import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090');
// Параллельные загрузки не должны отменять друг друга.
pb.autoCancellation(false);

// ---------- Авторизация ----------

// Плоский объект текущего участника или null. Сессия хранится SDK в localStorage.
export function currentUser() {
  const m = pb.authStore.isValid ? pb.authStore.record : null;
  return m ? { id: m.id, nick: m.nick, avatar: avatarUrl(m) } : null;
}

// Подписка на вход/выход (в том числе из другой вкладки).
export const onAuthChange = (fn) => pb.authStore.onChange(fn);

// Превращает ошибку SDK в понятное сообщение; поля — подсказки для подсветки.
function authError(err, kind) {
  if (err?.status === 0) return { message: 'Сервер недоступен. Попробуйте чуть позже.' };
  if (err?.status === 429) return { message: 'Слишком много попыток. Подождите минуту и повторите.' };
  const f = err?.response?.data || {};
  if (kind === 'login') {
    if (err?.status === 400) return { message: 'Неверный ник или пароль.' };
  } else {
    if (f.nick?.code === 'validation_not_unique') return { message: 'Этот ник уже занят.', field: 'nick' };
    if (f.nick) return { message: 'Ник: 3–24 символа, только латинские буквы, цифры и _.', field: 'nick' };
    if (f.password) return { message: 'Пароль слишком короткий: нужно минимум 8 символов.', field: 'password' };
  }
  return { message: 'Что-то пошло не так. Попробуйте ещё раз.' };
}

async function wrap(fn, kind) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    throw authError(err, kind);
  }
}

export const login = (nick, password) =>
  wrap(() => pb.collection('users').authWithPassword(nick, password), 'login');

// Регистрация открыта всем (только ник и пароль), затем сразу вход.
export const register = (nick, password) =>
  wrap(async () => {
    await pb.collection('users').create({ nick, password, passwordConfirm: password });
    await pb.collection('users').authWithPassword(nick, password);
  }, 'register');

export const logout = () => pb.authStore.clear();

const avatarUrl = (record) =>
  record.avatar ? pb.files.getURL(record, record.avatar, { thumb: '100x100' }) : null;

// Загружает всё одним заходом и приводит к плоским объектам, с которыми работает main.js.
export async function loadData() {
  const [drinkRecords, userRecords, ratingRecords] = await Promise.all([
    pb.collection('drinks').getFullList(),
    pb.collection('users').getFullList(),
    pb.collection('ratings').getFullList(),
  ]);

  const drinks = drinkRecords.map((d) => ({
    id: d.id,
    name: d.name,
    brand: d.brand,
    volume: d.volume,
    caffeine: d.caffeine,
    sugarFree: d.sugarFree,
    color: d.color,
  }));

  const users = userRecords.map((u) => ({
    id: u.id,
    nick: u.nick,
    avatar: avatarUrl(u),
    city: u.city || null,
  }));

  const ratings = ratingRecords.map((r) => ({
    userId: r.user,
    drinkId: r.drink,
    score: r.score,
    store: r.store || null,
  }));

  return { drinks, users, ratings };
}
