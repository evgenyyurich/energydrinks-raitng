import PocketBase from 'pocketbase';

const pb = new PocketBase(import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090');
// Параллельные загрузки не должны отменять друг друга.
pb.autoCancellation(false);

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
